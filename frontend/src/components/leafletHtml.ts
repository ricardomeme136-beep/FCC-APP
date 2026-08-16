// Shared Leaflet HTML for the real map (OpenStreetMap / Carto tiles, no API key).
// Rendered inside a WebView on native and an <iframe srcDoc> on web.
export function getLeafletHtml(centerLat = 38.7223, centerLng = -9.1393): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html,body,#map{height:100%;width:100%;margin:0;padding:0;background:#EAEDF2}
  .lm{border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);box-sizing:border-box}
  .lm.big{border-width:3px}
  .leaflet-container{background:#EAEDF2;font-family:sans-serif}
</style>
</head><body><div id="map"></div>
<script>
  var map = L.map('map',{zoomControl:true,attributionControl:true}).setView([${centerLat},${centerLng}],12);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
    maxZoom:19, subdomains:'abcd', attribution:'&copy; OpenStreetMap, &copy; CARTO'
  }).addTo(map);
  var markerLayer = L.layerGroup().addTo(map);
  var lineLayer = L.layerGroup().addTo(map);
  var didFit=false;

  function post(id){
    var msg = JSON.stringify({__wf:true,type:'marker',id:id});
    if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(msg); }
    if(window.parent && window.parent!==window){ window.parent.postMessage(msg,'*'); }
  }

  function render(d){
    if(!d) return;
    markerLayer.clearLayers(); lineLayer.clearLayers();
    var bounds=[];
    (d.polylines||[]).forEach(function(p){
      var pts=(p.coordinates||[]).map(function(c){return [c.latitude,c.longitude];});
      if(pts.length>1){ L.polyline(pts,{color:p.color||'#F97316',weight:p.width||4,opacity:0.9,lineJoin:'round'}).addTo(lineLayer); }
      pts.forEach(function(x){bounds.push(x);});
    });
    (d.markers||[]).forEach(function(m){
      var big=(m.kind==='truck'||m.kind==='next');
      var size=big?20:13;
      var icon=L.divIcon({className:'',iconSize:[size,size],iconAnchor:[size/2,size/2],
        html:'<div class="lm '+(big?'big':'')+'" style="width:'+size+'px;height:'+size+'px;background:'+(m.color||'#F97316')+'"></div>'});
      var mk=L.marker([m.lat,m.lng],{icon:icon}).addTo(markerLayer);
      mk.on('click',function(){post(m.id);});
      bounds.push([m.lat,m.lng]);
    });
    if(!didFit && bounds.length){ try{ map.fitBounds(bounds,{padding:[28,28],maxZoom:15}); }catch(e){} didFit=true; }
    setTimeout(function(){ map.invalidateSize(); },150);
  }
  window.__deliver = render;

  // web (iframe) channel
  window.addEventListener('message', function(e){
    try{ var d = typeof e.data==='string'?JSON.parse(e.data):e.data; if(d && d.__wf==='data'){ render(d.payload); } }catch(err){}
  });
  // signal ready
  function ready(){
    if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(JSON.stringify({__wf:true,type:'ready'})); }
    if(window.parent && window.parent!==window){ window.parent.postMessage(JSON.stringify({__wf:true,type:'ready'}),'*'); }
  }
  ready();
</script></body></html>`;
}

export type LatLng = { latitude: number; longitude: number };
export type MapMarker = {
  id: string; lat: number; lng: number; color?: string;
  kind?: "truck" | "container" | "incident" | "depot" | "facility" | "next"; label?: string;
};
export type RouteLine = { coordinates: LatLng[]; color?: string; width?: number };
export type FleetMapProps = {
  markers: MapMarker[];
  polylines?: RouteLine[];
  onPressMarker?: (id: string) => void;
  center?: { lat: number; lng: number };
  style?: any;
};
