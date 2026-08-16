import React, { useState } from "react";
import { Pressable, StyleSheet, View, Text } from "react-native";
import Svg, { Line, Polyline as SvgPolyline, Circle } from "react-native-svg";
import { colors, fonts, radius } from "@/src/theme";

export type LatLng = { latitude: number; longitude: number };
export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  color?: string;
  kind?: "truck" | "container" | "incident" | "depot" | "facility" | "next";
  label?: string;
};
export type RouteLine = { coordinates: LatLng[]; color?: string; width?: number };

type Props = {
  markers: MapMarker[];
  polylines?: RouteLine[];
  onPressMarker?: (id: string) => void;
  center?: { lat: number; lng: number };
  style?: any;
};

// Web schematic fallback (react-native-maps has no web build) — rendered with SVG
// for a clean "GPS route" look on the web preview.
export default function FleetMap({ markers, polylines, onPressMarker, style }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  const allPts = [
    ...markers.map((m) => ({ lat: m.lat, lng: m.lng })),
    ...(polylines || []).flatMap((p) => p.coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude }))),
  ];
  const lats = allPts.map((p) => p.lat);
  const lngs = allPts.map((p) => p.lng);
  const minLat = Math.min(...lats, 38.68);
  const maxLat = Math.max(...lats, 38.78);
  const minLng = Math.min(...lngs, -9.22);
  const maxLng = Math.max(...lngs, -9.08);
  const padLat = (maxLat - minLat) * 0.12 || 0.01;
  const padLng = (maxLng - minLng) * 0.12 || 0.01;

  const X = (lng: number) => ((lng - (minLng - padLng)) / (maxLng - minLng + 2 * padLng)) * size.w;
  const Y = (lat: number) => (1 - (lat - (minLat - padLat)) / (maxLat - minLat + 2 * padLat)) * size.h;

  return (
    <View
      style={[styles.container, style]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {size.w > 0 && (
        <Svg width={size.w} height={size.h}>
          {[...Array(8)].map((_, i) => (
            <Line key={`v${i}`} x1={(i / 7) * size.w} y1={0} x2={(i / 7) * size.w} y2={size.h} stroke={colors.divider} strokeWidth={1} />
          ))}
          {[...Array(8)].map((_, i) => (
            <Line key={`h${i}`} x1={0} y1={(i / 7) * size.h} x2={size.w} y2={(i / 7) * size.h} stroke={colors.divider} strokeWidth={1} />
          ))}
          {(polylines || []).map((p, i) => (
            <SvgPolyline
              key={`pl${i}`}
              points={p.coordinates.map((c) => `${X(c.longitude)},${Y(c.latitude)}`).join(" ")}
              fill="none"
              stroke={p.color || colors.brand}
              strokeWidth={p.width || 4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
          {markers.map((m) => {
            const r = m.kind === "truck" || m.kind === "next" ? 8 : 6;
            return (
              <Circle key={m.id} cx={X(m.lng)} cy={Y(m.lat)} r={r} fill={m.color || colors.brand} stroke="#fff" strokeWidth={2} />
            );
          })}
        </Svg>
      )}
      <Text style={styles.tag}>MAPA OPERACIONAL</Text>
      {/* tap targets */}
      {size.w > 0 &&
        markers.map((m) => (
          <Pressable
            key={`t-${m.id}`}
            testID={`map-marker-${m.id}`}
            onPress={() => onPressMarker?.(m.id)}
            style={{ position: "absolute", left: X(m.lng) - 12, top: Y(m.lat) - 12, width: 24, height: 24 }}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, overflow: "hidden" },
  tag: { position: "absolute", top: 10, left: 12, fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 0.6, color: colors.muted },
});
