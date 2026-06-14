'use client';

import { getAndroidPopUpHint, isAndroidDevice } from '@/lib/notifications';

interface NotificationPopUpHintProps {
  visible: boolean;
}

export default function NotificationPopUpHint({ visible }: NotificationPopUpHintProps) {
  if (!visible || !isAndroidDevice()) {
    return null;
  }

  return (
    <p className="mt-2 text-xs leading-relaxed text-[var(--color-muted-fg)]">
      {getAndroidPopUpHint()}
    </p>
  );
}
