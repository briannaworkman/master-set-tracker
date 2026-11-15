import * as Haptics from 'expo-haptics';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

/** −/+ counter with 44 px buttons. Shared with the card detail screen. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 999,
  label,
}: {
  value: number;
  onChange(n: number): void;
  min?: number;
  max?: number;
  /** Optional suffix for the button labels, e.g. "Reverse Holo" -> "Increase Reverse Holo". */
  label?: string;
}) {
  const theme = useTheme();
  const suffix = label ? ` ${label}` : '';
  const change = (n: number) => {
    void Haptics.selectionAsync();
    onChange(n);
  };
  const button = (label: string, a11y: string, disabled: boolean, next: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => change(next)}
      style={[styles.step, { borderColor: theme.border, opacity: disabled ? 0.4 : 1 }]}
    >
      <Text style={[styles.stepText, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {button('−', `Decrease${suffix}`, value <= min, value - 1)}
      <Text accessibilityLabel={`${value} owned`} style={[styles.value, { color: theme.text }]}>
        {value}
      </Text>
      {button('+', `Increase${suffix}`, value >= max, value + 1)}
    </View>
  );
}

export function CountPopover({
  visible,
  title,
  versionLabel,
  count,
  onChange,
  onClose,
}: {
  visible: boolean;
  title: string;
  versionLabel: string;
  count: number;
  onChange(n: number): void;
  onClose(): void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.overlay }]}>
        {/* A sibling behind the card, so taps on the card don't reach it. */}
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          <Text style={[styles.version, { color: theme.muted }]}>{versionLabel}</Text>
          <Stepper value={count} onChange={onChange} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done"
            onPress={onClose}
            style={[styles.done, { backgroundColor: theme.accent }]}
          >
            <Text style={[styles.doneText, { color: theme.bg }]}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { width: 260, borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  version: { fontSize: 13, marginTop: 2, marginBottom: 16, textAlign: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  step: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepText: { fontSize: 22, fontWeight: '500' },
  value: { minWidth: 64, textAlign: 'center', fontSize: 24, fontWeight: '700' },
  done: { marginTop: 20, minHeight: 44, alignSelf: 'stretch', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  doneText: { fontSize: 15, fontWeight: '600' },
});
