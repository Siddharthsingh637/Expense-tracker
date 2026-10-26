import { ImageSourcePropType } from 'react-native';
import { accessToken, API_BASE_URL } from './api';

export function photoSource(value?: string): ImageSourcePropType | undefined {
  if (!value) return undefined;
  if (!value.startsWith('attachment:')) return { uri: value };
  const id = value.slice('attachment:'.length);
  const token = accessToken();
  return { uri: `${API_BASE_URL}/api/v1/attachments/${encodeURIComponent(id)}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined };
}
