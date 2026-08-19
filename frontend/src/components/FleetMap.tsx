import React, { useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { colors, radius } from "@/src/theme";
import { getLeafletHtml, FleetMapProps } from "@/src/components/leafletHtml";

// Native: real OpenStreetMap/Carto map inside a WebView (no API key needed).
export default function FleetMap({ markers, polylines, onPressMarker, onDragMarker, onMapPress, followMarkerId, center, style }: FleetMapProps) {
  const ref = useRef<WebView>(null);
  const c = center || (markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : { lat: 38.7223, lng: -9.1393 });
  const html = useMemo(() => getLeafletHtml(c.lat, c.lng), []); // eslint-disable-line react-hooks/exhaustive-deps

  const deliver = () => {
    const payload = JSON.stringify({ markers, polylines: polylines || [], mapPressEnabled: !!onMapPress, followMarkerId });
    ref.current?.injectJavaScript(`window.__deliver && window.__deliver(${payload}); true;`);
  };

  // re-deliver whenever data changes
  React.useEffect(() => {
    deliver();
  }); // runs after each render; cheap JS inject

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        // Android only: without this, the WebView is promoted to its own
        // hardware-composited layer (effectively a SurfaceView), which
        // paints above every sibling View regardless of JSX order, zIndex,
        // or elevation — the exact "instruction bar hidden behind the map"
        // bug reported on a real Android device. Forcing it off makes the
        // WebView participate in normal view stacking again.
        renderToHardwareTextureAndroid={false}
        onLoadEnd={deliver}
        onMessage={(e) => {
          try {
            const d = JSON.parse(e.nativeEvent.data);
            if (d.__wf && d.type === "ready") deliver();
            if (d.__wf && d.type === "marker" && onPressMarker) onPressMarker(d.id);
            if (d.__wf && d.type === "drag" && onDragMarker) onDragMarker(d.id, d.lat, d.lng);
            if (d.__wf && d.type === "mapclick" && onMapPress) onMapPress(d.lat, d.lng);
          } catch {}
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#EAEDF2" },
  web: { flex: 1, backgroundColor: "#EAEDF2" },
});
