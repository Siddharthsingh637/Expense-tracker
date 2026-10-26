import { View, StyleSheet, FlatList, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft, Plus, Users } from 'lucide-react-native';
import { useState } from 'react';

import { Colors, Spacing, Radius, TouchTarget, Fonts, FontSize } from '@/theme';
import { Text, Avatar, Divider, EmptyState, Button } from '@/components';
import { usePaisaStore } from '@/data/local/store';

export default function PeopleScreen() {
  const people = usePaisaStore((s) => s.people);
  const addPerson = usePaisaStore((s) => s.addPerson);
  const [newName, setNewName] = useState('');

  const active = people.filter((p) => !p.isArchived);

  function handleAdd() {
    const name = newName.trim();
    if (!name) return;
    addPerson({ name, isMe: false, isArchived: false });
    setNewName('');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={Colors.text} />
        </Pressable>
        <Text variant="bodySemiBold">People</Text>
        <View style={{ width: TouchTarget }} />
      </View>

      {/* Add person */}
      <View style={styles.addRow}>
        <TextInput
          style={styles.nameInput}
          value={newName}
          onChangeText={setNewName}
          placeholder="Add person…"
          placeholderTextColor={Colors.muted}
          returnKeyType="done"
          onSubmitEditing={handleAdd}
          accessibilityLabel="New person name"
        />
        <Pressable
          style={[styles.addBtn, !newName.trim() && styles.addBtnDisabled]}
          onPress={handleAdd}
          disabled={!newName.trim()}
          accessibilityRole="button"
          accessibilityLabel="Add person"
        >
          <Plus size={18} color={Colors.text} />
        </Pressable>
      </View>

      {active.length === 0 ? (
        <EmptyState
          icon={<Users size={40} color={Colors.muted} />}
          title="No people yet"
          subtitle="Add friends to split bills with them"
        />
      ) : (
        <FlatList
          data={active}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <Divider inset={52} />}
          renderItem={({ item }) => (
            <View style={styles.personRow}>
              <Avatar name={item.name} isMe={item.isMe} size={36} />
              <View style={styles.personInfo}>
                <Text variant="bodyMedium">{item.name}</Text>
                {item.isMe && <Text variant="caption" color={Colors.muted}>You</Text>}
                {item.upiId && <Text variant="caption" color={Colors.muted}>{item.upiId}</Text>}
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  backBtn: { width: TouchTarget, height: TouchTarget, alignItems: 'center', justifyContent: 'center' },
  addRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.base,
    borderBottomWidth: 1,
    borderBottomColor: Colors.hairline,
  },
  nameInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.hairline,
    height: 44,
    paddingHorizontal: Spacing.base,
    color: Colors.text,
    fontFamily: Fonts.sans,
    fontSize: FontSize.base,
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.4 },
  list: { padding: Spacing.base },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    minHeight: TouchTarget,
  },
  personInfo: { gap: 2 },
});
