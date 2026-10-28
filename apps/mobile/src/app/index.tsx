import { Redirect } from 'expo-router';
import { useFinancerStore } from '@/data/local/store';
import { hasSession } from '@/data/remote/api';

export default function Index() {
  const isOnboarded = useFinancerStore((s) => s.isOnboarded);

  if (!isOnboarded) {
    return <Redirect href={hasSession() ? '/(auth)/onboarding-budget' : '/(auth)/welcome'} />;
  }

  return <Redirect href="/(tabs)" />;
}
