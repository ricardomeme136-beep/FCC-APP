import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { colors, radius } from "@/src/theme";
import { getLeafletHtml, FleetMapProps } from "@/src/components/leafletHtml";

// Web: real OpenStreetMap/Carto map inside a same-origin <iframe srcDoc>.
export default function FleetMap({ markers, polylines, onPressMarker, center, style }: FleetMapProps) {
  const iframeRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const c = center || (markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : { lat: 38.7223, lng: -9.1393 });
  const html = useMemo(() => getLeafletHtml(c.lat, c.lng), []); // eslint-disable-line react-hooks/exhaustive-deps

  // listen for marker clicks + ready signal from the iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d && d.__wf && d.type === "ready") setReady(true);
        if (d && d.__wf && d.type === "marker" && onPressMarker) onPressMarker(d.id);
      } catch {}
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onPressMarker]);

  // deliver data to the iframe when ready or when data changes
  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (win && ready) {
      win.postMessage({ __wf: "data", payload: { markers, polylines: polylines || [] } }, "*");
    }
  }, [ready, markers, polylines]);

  return (
    <View style={[styles.container, style]}>
      {React.createElement("iframe", {
        ref: iframeRef,
        srcDoc: html,
        onLoad: () => setReady(true),
        style: { width: "100%", height: "100%", border: "none", display: "block" },
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderRadius: radius.lg, overflow: "hidden", backgroundColor: "#EAEDF2" },
});
