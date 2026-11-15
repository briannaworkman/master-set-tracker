import { createContext, useContext } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/useTheme';

/** Whether the collection store saves to disk. Only the web fallback sets this to false. */
export const PersistenceContext = createContext(true);

/** One line under the header on web when changes aren't saved; renders nothing otherwise. */
export function WebPreviewNote() {
  const persistent = useContext(PersistenceContext);
  const theme = useTheme();
  if (persistent || Platform.OS !== 'web') return null;
  return <Text style={[styles.note, { color: theme.muted }]}>Web preview — changes aren't saved</Text>;
}

const styles = StyleSheet.create({
  note: { fontSize: 13, textAlign: 'center', paddingVertical: 8 },
});
