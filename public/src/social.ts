export const SOCIAL_PLATFORM_OPTIONS = [
  { value: 'x', label: 'X' },
  { value: 'github', label: 'GitHub' },
  { value: 'slack', label: 'Slack' },
  { value: 'discord', label: 'Discord' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'custom', label: 'Custom' },
] as const;

export type SocialPlatformValue = typeof SOCIAL_PLATFORM_OPTIONS[number]['value'];

export function socialPlatformLabel(value: string) {
  return SOCIAL_PLATFORM_OPTIONS.find((item) => item.value === value)?.label || 'Social';
}

export function socialHandlePlaceholder(value: string) {
  switch (value) {
    case 'x':
      return '@handle or profile URL';
    case 'github':
      return 'username or profile URL';
    case 'slack':
      return 'workspace / profile reference';
    case 'discord':
      return 'username or invite URL';
    case 'instagram':
      return '@handle or profile URL';
    case 'custom':
      return 'Custom social profile or identifier';
    default:
      return 'Social profile or handle';
  }
}
