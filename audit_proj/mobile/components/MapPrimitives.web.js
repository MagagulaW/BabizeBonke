import React from 'react';
import { View, Text } from 'react-native';
export function MapView({ style, children }) {
  return (
    <View style={[{ minHeight: 280, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center', padding: 16 }, style]}>
      <Text style={{ color: '#fff7ef', fontWeight: '700', textAlign: 'center' }}>Map preview is available on Android and iPhone builds.</Text>
      <Text style={{ color: '#f3c8a5', marginTop: 8, textAlign: 'center' }}>Use a native Expo build to place the exact delivery pin on a live map.</Text>
      {children}
    </View>
  );
}
export function Marker() { return null; }
