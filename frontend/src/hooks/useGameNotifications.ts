'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getNotificationPermission,
  isNotificationSupported,
  registerPushSubscriptionWithServer,
  requestNotificationPermission,
  showQuestionNotification,
} from '@/lib/notifications';
import { shouldNotifyWhenBackgrounded } from '@/lib/notificationDisplay';
import { hasQuestionAlertHandled } from '@/lib/questionAlerts';
import { getSocketClient } from '@/lib/socket';
import { SERVER_EVENTS, type QuestionEvent } from '@/lib/types';

interface UseGameNotificationsOptions {
  lobbyCode: string;
  enabled: boolean;
  playerId?: string;
  playQuestionSound?: () => void;
}

export function useGameNotifications({
  lobbyCode,
  enabled,
  playerId,
  playQuestionSound,
}: UseGameNotificationsOptions) {
  const [permission, setPermission] = useState<NotificationPermission>(() => getNotificationPermission());
  const [showPrompt, setShowPrompt] = useState(false);
  const [showPopUpHint, setShowPopUpHint] = useState(false);
  const pushRegisteredRef = useRef(false);

  const refreshPermission = useCallback(() => {
    setPermission(getNotificationPermission());
  }, []);

  const registerPush = useCallback(async () => {
    const registered = await registerPushSubscriptionWithServer({ playerId });
    pushRegisteredRef.current = registered;
    return registered;
  }, [playerId]);

  const enableNotifications = useCallback(async () => {
    const nextPermission = await requestNotificationPermission();
    setPermission(nextPermission);

    if (nextPermission === 'granted') {
      setShowPrompt(false);
      pushRegisteredRef.current = false;
      const registered = await registerPush();
      setShowPopUpHint(registered);
    }
  }, [registerPush]);

  const dismissPrompt = useCallback(() => {
    setShowPrompt(false);
  }, []);

  useEffect(() => {
    if (!enabled || !isNotificationSupported()) {
      setShowPrompt(false);
      return;
    }

    if (permission === 'default') {
      setShowPrompt(true);
    }
  }, [enabled, permission]);

  useEffect(() => {
    if (!enabled || permission !== 'granted' || pushRegisteredRef.current) {
      return;
    }

    void registerPush();
  }, [enabled, permission, registerPush]);

  useEffect(() => {
    if (!enabled || permission !== 'granted' || !playerId) {
      return undefined;
    }

    const socket = getSocketClient();
    return socket.on('connected', () => {
      void registerPushSubscriptionWithServer({ playerId });
    });
  }, [enabled, permission, playerId]);

  useEffect(() => {
    if (!enabled || permission !== 'granted') {
      return undefined;
    }

    const socket = getSocketClient();
    return socket.on(SERVER_EVENTS.QUESTION_EVENT, (event: QuestionEvent) => {
      if (hasQuestionAlertHandled(event.instanceId)) {
        return;
      }

      if (!shouldNotifyWhenBackgrounded(document.visibilityState, document.hasFocus())) {
        return;
      }

      playQuestionSound?.();

      void showQuestionNotification({
        questionText: event.questionText,
        lobbyCode,
        instanceId: event.instanceId,
      });
    });
  }, [enabled, lobbyCode, permission, playQuestionSound]);

  useEffect(() => {
    const onVisibilityChange = () => {
      refreshPermission();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
    };
  }, [refreshPermission]);

  return {
    permission,
    showPrompt: enabled && showPrompt && permission === 'default' && isNotificationSupported(),
    showPopUpHint: enabled && showPopUpHint,
    enableNotifications,
    dismissPrompt,
  };
}
