// Shared Leaflet HTML for the real map (OpenStreetMap / Carto tiles, no API key).
// Rendered inside a WebView on native and an <iframe srcDoc> on web.
export function getLeafletHtml(centerLat = 38.7223, centerLng = -9.1393): string {
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css"/>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<style>
  html,body,#map{height:100%;width:100%;margin:0;padding:0;background:#EAEDF2}
  .lm{border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);box-sizing:border-box}
  .lm.big{border-width:3px}
  .leaflet-container{background:#EAEDF2;font-family:sans-serif}
  /* Smooth glide between successive positions instead of a hard jump —
     scoped to just live-driver markers so static pins (stops, depots,
     incidents) never pick up an unwanted transition during pan/zoom. */
  .wf-live-marker{transition:transform 0.6s linear;}
  .wf-cluster{background:transparent!important;border:none!important;}
</style>
</head><body><div id="map"></div>
<script>
  var map = L.map('map',{zoomControl:false,attributionControl:true}).setView([${centerLat},${centerLng}],12);
  L.control.zoom({position:'topright'}).addTo(map);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
    maxZoom:19, subdomains:'abcd', attribution:'&copy; OpenStreetMap, &copy; CARTO'
  }).addTo(map);
  var markerLayer = L.layerGroup().addTo(map);
  var lineLayer = L.layerGroup().addTo(map);
  // Only waste-container pins ever cluster — live driver markers must always
  // read individually, never merged into a "3 drivers here" bubble.
  var wasteCluster = (typeof L.markerClusterGroup === 'function')
    ? L.markerClusterGroup({maxClusterRadius:50, disableClusteringAtZoom:17,
        iconCreateFunction:function(cluster){
          var n=cluster.getChildCount();
          return L.divIcon({className:'wf-cluster',iconSize:[34,34],
            html:'<div style="width:34px;height:34px;border-radius:50%;background:#111827;border:3px solid #fff;'+
              'box-shadow:0 2px 6px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;'+
              'color:#fff;font-family:sans-serif;font-weight:700;font-size:12px;">'+n+'</div>'});
        }}).addTo(map)
    : markerLayer;
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
    if(wasteCluster!==markerLayer){ wasteCluster.clearLayers(); }
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
      if(m.kind==='truck'){
        // Real-GPS "you are here" look: a soft halo behind a solid dot with
        // a vehicle glyph, plus a directional cone when heading is known.
        // North-up map: only the cone rotates to face 'heading' (map bearing
        // rotation is a documented future step, not built yet).
        var ts = m.size || 44;
        var dot = Math.round(ts*0.55);
        var cone = hasHeading
          ? '<div style="position:absolute;left:50%;top:50%;width:0;height:0;'+
            'border-left:'+(ts*0.42)+'px solid transparent;border-right:'+(ts*0.42)+'px solid transparent;'+
            'border-bottom:'+(ts*0.95)+'px solid rgba(37,99,235,0.28);'+
            'transform:translate(-50%,-100%) rotate('+m.heading+'deg);transform-origin:50% 100%;"></div>'
          : '';
        var html='<div style="position:relative;width:'+ts+'px;height:'+ts+'px;">'+cone+
          '<div style="position:absolute;left:50%;top:50%;width:'+ts+'px;height:'+ts+'px;transform:translate(-50%,-50%);'+
            'border-radius:50%;background:'+(m.color||'#111827')+';opacity:0.16;"></div>'+
          '<div style="position:absolute;left:50%;top:50%;width:'+dot+'px;height:'+dot+'px;transform:translate(-50%,-50%);'+
            'border-radius:50%;background:'+(m.color||'#111827')+';border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);'+
            'display:flex;align-items:center;justify-content:center;font-size:'+Math.round(dot*0.52)+'px;line-height:1;">🚚</div>'+
        '</div>';
        icon=L.divIcon({className:'',iconSize:[ts,ts],iconAnchor:[ts/2,ts/2],html:html});
      } else if(m.kind==='driver'){
        // Admin live map: a driver with an in_progress route — a person, not
        // a vehicle, since the whole point is "where is my driver right
        // now", and their name is the thing an admin actually reads first.
        var ts2 = m.size || 40;
        var LABEL_H = 20;
        var boxH = ts2 + LABEL_H;
        var stale = !!m.stale;
        var bg2 = stale ? '#9CA3AF' : (m.color || '#F97316');
        var person = '<svg viewBox="0 0 24 24" width="'+Math.round(ts2*0.5)+'" height="'+Math.round(ts2*0.5)+'" fill="#fff">'+
          '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7v1H4v-1z"/></svg>';
        var label2 = m.label
          ? '<div style="position:absolute;left:50%;top:0;transform:translateX(-50%);white-space:nowrap;'+
            'background:#fff;color:#111827;font-size:11px;font-weight:700;font-family:sans-serif;'+
            'padding:2px 7px;border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,.3);pointer-events:none;">'+m.label+
            (stale?' <span style="color:#9CA3AF;">·desatualizado</span>':'')+'</div>'
          : '';
        var cone2 = (hasHeading && !stale)
          ? '<div style="position:absolute;left:50%;top:'+(LABEL_H+ts2/2)+'px;width:0;height:0;'+
            'border-left:'+(ts2*0.22)+'px solid transparent;border-right:'+(ts2*0.22)+'px solid transparent;'+
            'border-bottom:'+(ts2*0.5)+'px solid '+bg2+';opacity:0.85;'+
            'transform:translate(-50%,-100%) rotate('+m.heading+'deg);transform-origin:50% 100%;"></div>'
          : '';
        var circle2 = '<div style="position:absolute;left:50%;top:'+LABEL_H+'px;width:'+ts2+'px;height:'+ts2+'px;transform:translateX(-50%);'+
          'border-radius:50%;background:'+bg2+';border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);'+
          'display:flex;align-items:center;justify-content:center;opacity:'+(stale?0.6:1)+';">'+person+'</div>';
        var html2='<div style="position:relative;width:'+ts2+'px;height:'+boxH+'px;">'+label2+cone2+circle2+'</div>';
        icon=L.divIcon({className:'wf-live-marker',iconSize:[ts2,boxH],iconAnchor:[ts2/2,LABEL_H+ts2/2],html:html2});
      } else if(m.kind==='waste_bin'){
        // Real waste-container inventory pins (admin map only) — a distinct
        // kind from the plain 'container' dots used elsewhere for route
        // stops (navegacao.tsx, mapa-rota.tsx), which stay untouched.
        var bs = m.size || 26;
        var ring2 = m.selected ? 'box-shadow:0 0 0 4px rgba(249,115,22,0.35);' : 'box-shadow:0 1px 3px rgba(0,0,0,.4);';
        var bin = '<svg viewBox="0 0 24 24" width="'+Math.round(bs*0.6)+'" height="'+Math.round(bs*0.6)+'" fill="none" '+
          'stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+
          '<line x1="4" y1="7" x2="20" y2="7"/>'+
          '<path d="M6 7l1.2 13a1.5 1.5 0 0 0 1.5 1.4h6.6a1.5 1.5 0 0 0 1.5-1.4L18 7"/>'+
          '<line x1="9" y1="4" x2="15" y2="4"/><line x1="9" y1="4" x2="6" y2="7"/><line x1="15" y1="4" x2="18" y2="7"/>'+
        '</svg>';
        icon=L.divIcon({className:'',iconSize:[bs,bs],iconAnchor:[bs/2,bs/2],
          html:'<div style="width:'+bs+'px;height:'+bs+'px;border-radius:8px;background:'+(m.color||'#6B7280')+';'+
            'border:2px solid #fff;'+ring2+'display:flex;align-items:center;justify-content:center;">'+bin+'</div>'});
      } else {
        var size = m.size || (m.label ? 28 : (big?20:(m.selected?18:13)));
        var ring = m.selected ? 'box-shadow:0 0 0 4px rgba(249,115,22,0.35);' : 'box-shadow:0 1px 3px rgba(0,0,0,.4);';
        var labelHtml = m.label
          ? '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;font-family:sans-serif;">'+m.label+'</span>'
          : '';
        icon=L.divIcon({className:'',iconSize:[size,size],iconAnchor:[size/2,size/2],
          html:'<div class="lm '+(big?'big':'')+'" style="position:relative;width:'+size+'px;height:'+size+'px;background:'+(m.color||'#F97316')+';'+ring+'">'+labelHtml+'</div>'});
      }
      var targetLayer = (m.kind==='waste_bin') ? wasteCluster : markerLayer;
      var mk=L.marker([m.lat,m.lng],{icon:icon, draggable: !!m.draggable}).addTo(targetLayer);
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
  kind?: "truck" | "container" | "incident" | "depot" | "facility" | "next" | "driver" | "waste_bin";
  label?: string;      // short text drawn inside the marker (e.g. a stop number, or a driver's name for "driver")
  selected?: boolean;  // highlighted ring — cross-reference with a side-panel list
  draggable?: boolean; // native/web: reports new lat/lng on drag end
  heading?: number;    // degrees clockwise from north — draws a directional cone behind a "truck"/"driver" kind marker
  size?: number;       // overrides the marker's default pixel size
  stale?: boolean;     // "driver" kind only — grays out the marker when the position is older than the admin map's freshness threshold
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
