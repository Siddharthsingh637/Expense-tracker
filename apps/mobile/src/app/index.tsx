import { Redirect } from 'expo-router';
import { usePaisaStore } from '@/data/local/store';
import { hasSession } from '@/data/remote/api';

export default function Index() {
  const isOnboarded = usePaisaStore((s) => s.isOnboarded);

  if (!isOnboarded) {
    return <Redirect href={hasSession() ? '/(auth)/onboarding-budget' : '/(auth)/welcome'} />;
  }

  return <Redirect href="/(tabs)" />;
}
