import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface HeaderProps {
  onOpenSidebar: () => void;
  onOpenSettings: () => void;
}

export default function AppHeader({ onOpenSidebar, onOpenSettings }: HeaderProps) {
  return (
    <View style={styles.headerContainer}>
      {/* ផ្នែកខាងឆ្វេង៖ ប៊ូតុង Settings (ការកំណត់) */}
      <TouchableOpacity style={styles.iconButton} onPress={onOpenSettings}>
        <Ionicons name="settings-outline" size={20} color="#94A3B8" />
      </TouchableOpacity>

      {/* ផ្នែកកណ្ដាល៖ ឡូហ្គោ PAI ម៉ូដ Premium */}
      <View style={styles.logoContainer}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>PAI</Text>
        </View>
        <Text style={styles.brandText}>Phollet AI</Text>
      </View>

      {/* ផ្នែកខាងស្ដាំ៖ ប៊ូតុង បើកប្រវត្តិឆាត (Sidebar) */}
      <TouchableOpacity style={styles.iconButton} onPress={onOpenSidebar}>
        <Ionicons name="chatbubbles-outline" size={20} color="#94A3B8" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 12,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
  },
  logoText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  brandText: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
});