import React, { useState } from "react";
import { Pressable, StyleSheet, View, Text } from "react-native";
import { colors, fonts } from "@/src/theme";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  color?: string;
  label?: string;
  heading?: number;
};

type Props = {
  markers: MapMarker[];
  polyline?: { latitude: number; longitude: number }[];
  onPressMarker?: (id: string) => void;
  center?: { lat: number; lng: number };
  style?: any;
};

// Web schematic fallback (react-native-maps has no web build).
export default function FleetMap({ markers, polyline, onPressMarker, style }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  const pts = [
    ...markers.map((m) => ({ lat: m.lat, lng: m.lng })),
    ...(polyline || []).map((p) => ({ lat: p.latitude, lng: p.longitude })),
  ];
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats, 38.68);
  const maxLat = Math.max(...lats, 38.78);
  const minLng = Math.min(...lngs, -9.22);
  const maxLng = Math.max(...lngs, -9.08);
  const padLat = (maxLat - minLat) * 0.1 || 0.01;
  const padLng = (maxLng - minLng) * 0.1 || 0.01;

  const toXY = (lat: number, lng: number) => {
    const x = ((lng - (minLng - padLng)) / (maxLng - minLng + 2 * padLng)) * size.w;
    const y = (1 - (lat - (minLat - padLat)) / (maxLat - minLat + 2 * padLat)) * size.h;
    return { x, y };
  };

  return (
    <View
      style={[styles.container, style]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {/* grid */}
      {[...Array(7)].map((_, i) => (
        <View key={`v${i}`} style={[styles.gridV, { left: `${(i / 6) * 100}%` }]} />
      ))}
      {[...Array(7)].map((_, i) => (
        <View key={`h${i}`} style={[styles.gridH, { top: `${(i / 6) * 100}%` }]} />
      ))}
      <Text style={styles.tag}>MAPA OPERACIONAL</Text>

      {size.w > 0 &&
        markers.map((m) => {
          const { x, y } = toXY(m.lat, m.lng);
          return (
            <Pressable
              key={m.id}
              testID={`map-marker-${m.id}`}
              onPress={() => onPressMarker?.(m.id)}
              style={[styles.marker, { left: x - 7, top: y - 7, backgroundColor: m.color || colors.brand }]}
            />
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    overflow: "hidden",
  },
  gridV: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: colors.border },
  gridH: { position: "absolute", left: 0, right: 0, height: 1, backgroundColor: colors.border },
  tag: {
    position: "absolute",
    top: 8,
    left: 8,
    fontFamily: fonts.monoBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted,
  },
  marker: { position: "absolute", width: 14, height: 14, borderWidth: 2, borderColor: "#0A0A0A" },
});
