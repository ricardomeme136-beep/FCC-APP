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
  var didFollow=false;

  function send(msg){
    var s = JSON.stringify(msg);
    if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(s); }
    if(window.parent && window.parent!==window){ window.parent.postMessage(s,'*'); }
  }
  function post(id){ send({__wf:true,type:'marker',id:id}); }
  function postDrag(id,lat,lng){ send({__wf:true,type:'drag',id:id,lat:lat,lng:lng}); }

  var mapPressEnabled = false;
  map.on('click', function(e){
    if(mapPressEnabled){ send({__wf:true,type:'mapclick',lat:e.latlng.lat,lng:e.latlng.lng}); }
  });

  function render(d){
    if(!d) return;
    mapPressEnabled = !!d.mapPressEnabled;
    markerLayer.clearLayers(); lineLayer.clearLayers();
    var bounds=[];
    (d.polylines||[]).forEach(function(p){
      var pts=(p.coordinates||[]).map(function(c){return [c.latitude,c.longitude];});
      if(pts.length>1){ L.polyline(pts,{color:p.color||'#F97316',weight:p.width||4,opacity:0.9,lineJoin:'round'}).addTo(lineLayer); }
      pts.forEach(function(x){bounds.push(x);});
    });
    var followLatLng=null;
    (d.markers||[]).forEach(function(m){
      var big=(m.kind==='truck'||m.kind==='next');
      var hasHeading = (m.heading!=null && !isNaN(m.heading));
      var icon;
      if(hasHeading){
        // North-up map: only the marker itself rotates to face 'heading'
        // (map bearing rotation is a documented future step, not built yet).
        var s=26;
        var arrow='<div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;'+
          'border-bottom:22px solid '+(m.color||'#F97316')+';filter:drop-shadow(0 1px 2px rgba(0,0,0,.45));'+
          'transform:rotate('+m.heading+'deg);transform-origin:50% 65%;"></div>';
        icon=L.divIcon({className:'',iconSize:[s,s],iconAnchor:[s/2,s/2],html:arrow});
      } else {
        var size = m.label ? 28 : (big?20:(m.selected?18:13));
        var ring = m.selected ? 'box-shadow:0 0 0 4px rgba(249,115,22,0.35);' : 'box-shadow:0 1px 3px rgba(0,0,0,.4);';
        var labelHtml = m.label
          ? '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;font-family:sans-serif;">'+m.label+'</span>'
          : '';
        icon=L.divIcon({className:'',iconSize:[size,size],iconAnchor:[size/2,size/2],
          html:'<div class="lm '+(big?'big':'')+'" style="position:relative;width:'+size+'px;height:'+size+'px;background:'+(m.color||'#F97316')+';'+ring+'">'+labelHtml+'</div>'});
      }
      var mk=L.marker([m.lat,m.lng],{icon:icon, draggable: !!m.draggable}).addTo(markerLayer);
      mk.on('click',function(){post(m.id);});
      if(m.draggable){
        mk.on('dragend', function(ev){ var ll=ev.target.getLatLng(); postDrag(m.id, ll.lat, ll.lng); });
      }
      bounds.push([m.lat,m.lng]);
      if(d.followMarkerId && m.id===d.followMarkerId){ followLatLng=[m.lat,m.lng]; }
    });

    if(d.followMarkerId && followLatLng){
      if(!didFollow){ map.setView(followLatLng, 17); didFollow=true; }
      else { map.panTo(followLatLng, {animate:true, duration:0.5}); }
      // Nudge the vehicle towards the lower-center of the screen instead of
      // dead-center, so more of the map ahead stays visible (best-effort —
      // real "ahead" needs map-bearing rotation, a documented future step).
      setTimeout(function(){
        try{ var h=map.getSize().y; map.panBy([0,-h*0.16],{animate:false}); }catch(e){}
      },60);
    } else if(!didFit && bounds.length){
      try{ map.fitBounds(bounds,{padding:[28,28],maxZoom:15}); }catch(e){}
      didFit=true;
    }
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
  kind?: "truck" | "container" | "incident" | "depot" | "facility" | "next";
  label?: string;      // short text drawn inside the marker (e.g. a stop number)
  selected?: boolean;  // highlighted ring — cross-reference with a side-panel list
  draggable?: boolean; // native/web: reports new lat/lng on drag end
  heading?: number;    // degrees clockwise from north — draws a rotated arrow instead of a dot
};
export type RouteLine = { coordinates: LatLng[]; color?: string; width?: number };
export type FleetMapProps = {
  markers: MapMarker[];
  polylines?: RouteLine[];
  onPressMarker?: (id: string) => void;
  onDragMarker?: (id: string, lat: number, lng: number) => void;
  onMapPress?: (lat: number, lng: number) => void; // opt-in: tap the map itself to add a point
  followMarkerId?: string; // opt-in: keep re-centering on this marker as it moves (navigation mode)
  center?: { lat: number; lng: number };
  style?: any;
};
