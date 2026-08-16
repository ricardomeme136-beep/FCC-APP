import React from "react";
import { StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_DEFAULT } from "react-native-maps";
import { colors } from "@/src/theme";

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

export default function FleetMap({ markers, polyline, onPressMarker, center, style }: Props) {
  const c = center || (markers[0] ? { lat: markers[0].lat, lng: markers[0].lng } : { lat: 38.7223, lng: -9.1393 });
  return (
    <View style={[styles.container, style]}>
      <MapView
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: c.lat,
          longitude: c.lng,
          latitudeDelta: 0.09,
          longitudeDelta: 0.09,
        }}
      >
        {polyline && polyline.length > 1 ? (
          <Polyline coordinates={polyline} strokeColor={colors.brand} strokeWidth={4} />
        ) : null}
        {markers.map((m) => (
          <Marker
            key={m.id}
            coordinate={{ latitude: m.lat, longitude: m.lng }}
            onPress={() => onPressMarker?.(m.id)}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.marker, { backgroundColor: m.color || colors.brand }]}>
              {m.label ? <View /> : null}
            </View>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, borderWidth: 2, borderColor: colors.borderStrong, overflow: "hidden" },
  marker: {
    width: 16,
    height: 16,
    borderWidth: 2,
    borderColor: "#0A0A0A",
  },
});
