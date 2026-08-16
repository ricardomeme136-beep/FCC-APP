import React from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { colors, radius } from "@/src/theme";

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

export default function FleetMap({ markers, polylines, onPressMarker, center, style }: Props) {
  const c = center || (markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : { lat: 38.7223, lng: -9.1393 });
  return (
    <View style={[styles.container, style]}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: c.lat, longitude: c.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
      >
        {(polylines || []).map((p, i) => (
          <Polyline key={`pl-${i}`} coordinates={p.coordinates} strokeColor={p.color || colors.brand} strokeWidth={p.width || 4} />
        ))}
        {markers.map((m) => (
          <Marker key={m.id} coordinate={{ latitude: m.lat, longitude: m.lng }} onPress={() => onPressMarker?.(m.id)} anchor={{ x: 0.5, y: 0.5 }}>
            <MarkerDot color={m.color || colors.brand} kind={m.kind} />
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

function MarkerDot({ color, kind }: { color: string; kind?: string }) {
  if (kind === "truck" || kind === "next") {
    return (
      <View style={[styles.truck, { backgroundColor: color }]}>
        <View style={styles.truckInner} />
      </View>
    );
  }
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceSecondary },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: "#fff" },
  truck: { width: 22, height: 22, borderRadius: 11, borderWidth: 3, borderColor: "#fff", alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 3 },
  truckInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#fff" },
});
