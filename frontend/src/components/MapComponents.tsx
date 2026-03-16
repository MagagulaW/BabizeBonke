import { useMemo } from 'react';
import { MapContainer, Marker, Polyline, TileLayer, useMapEvents } from 'react-leaflet';
import L, { LeafletMouseEvent } from 'leaflet';

type LatLng = { latitude: number; longitude: number };

type PickerProps = {
  value: LatLng;
  onChange: (value: LatLng) => void;
  height?: number;
};

type TrackingProps = {
  driverLocation?: LatLng | null;
  pickupLocation?: LatLng | null;
  dropoffLocation?: LatLng | null;
  height?: number;
};

function buildIcon(label: string, color: string) {
  return L.divIcon({
    className: 'map-pin-wrapper',
    html: `<div class="map-pin" style="background:${color}">${label}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

const customerIcon = buildIcon('C', '#111111');
const driverIcon = buildIcon('D', '#ff3d1f');
const pickupIcon = buildIcon('R', '#ff8a00');

function PickerListener({ onChange }: { onChange: (value: LatLng) => void }) {
  useMapEvents({
    click(event: LeafletMouseEvent) {
      onChange({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    }
  });
  return null;
}

export function MapPicker({ value, onChange, height = 300 }: PickerProps) {
  const center: [number, number] = [value.latitude, value.longitude];
  return (
    <div className="map-shell" style={{ height }}>
      <MapContainer center={center} zoom={13} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <PickerListener onChange={onChange} />
        <Marker position={center} icon={customerIcon} />
      </MapContainer>
    </div>
  );
}

export function LiveTrackingMap({ driverLocation, pickupLocation, dropoffLocation, height = 320 }: TrackingProps) {
  const center = useMemo<[number, number]>(() => {
    const first = driverLocation || dropoffLocation || pickupLocation || { latitude: -26.2041, longitude: 28.0473 };
    return [first.latitude, first.longitude];
  }, [driverLocation, dropoffLocation, pickupLocation]);

  const line = useMemo(() => {
    return [pickupLocation, driverLocation, dropoffLocation]
      .filter(Boolean)
      .map((point) => [Number(point!.latitude), Number(point!.longitude)] as [number, number]);
  }, [pickupLocation, driverLocation, dropoffLocation]);

  return (
    <div className="map-shell live-map" style={{ height }}>
      <MapContainer center={center} zoom={13} scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pickupLocation ? <Marker position={[pickupLocation.latitude, pickupLocation.longitude]} icon={pickupIcon} /> : null}
        {dropoffLocation ? <Marker position={[dropoffLocation.latitude, dropoffLocation.longitude]} icon={customerIcon} /> : null}
        {driverLocation ? <Marker position={[driverLocation.latitude, driverLocation.longitude]} icon={driverIcon} /> : null}
        {line.length >= 2 ? <Polyline positions={line} pathOptions={{ color: '#ff5a1f', weight: 5, opacity: 0.85 }} /> : null}
      </MapContainer>
    </div>
  );
}
