import {
  getNotificationAssetPaths,
  shouldNotifyWhenBackgrounded,
  shouldSuppressQuestionNotification,
} from './notificationDisplay';

describe('notificationDisplay', () => {
  it('notifies when the tab is hidden or unfocused', () => {
    expect(shouldNotifyWhenBackgrounded('hidden', true)).toBe(true);
    expect(shouldNotifyWhenBackgrounded('visible', false)).toBe(true);
    expect(shouldNotifyWhenBackgrounded('visible', true)).toBe(false);
  });

  it('suppresses push only when a focused game tab is visible', () => {
    expect(shouldSuppressQuestionNotification([
      { url: 'https://app.test/game/ABC', visibilityState: 'visible', focused: true },
    ])).toBe(true);

    expect(shouldSuppressQuestionNotification([
      { url: 'https://app.test/game/ABC', visibilityState: 'visible', focused: false },
    ])).toBe(false);

    expect(shouldSuppressQuestionNotification([
      { url: 'https://app.test/game/ABC', visibilityState: 'hidden', focused: false },
    ])).toBe(false);

    expect(shouldSuppressQuestionNotification([
      { url: 'https://app.test/', visibilityState: 'visible', focused: true },
    ])).toBe(false);
  });

  it('uses monochrome icon and badge assets', () => {
    expect(getNotificationAssetPaths('https://app.test')).toEqual({
      icon: 'https://app.test/notification-icon.png',
      badge: 'https://app.test/notification-badge.png',
    });
  });
});
