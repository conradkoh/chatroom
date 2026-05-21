/**
 * handleNotificationClick — pure decision logic tests
 *
 * Tests the notification-click action selection in isolation from the
 * service worker runtime.
 */

import { describe, expect, it } from 'vitest';
import { decideNotificationClickAction } from './handleNotificationClick';

const makeClient = (url: string) => ({ url });

const APP_HOME = 'https://app.chatroom.dev/app';
const CHATROOM_A = 'https://app.chatroom.dev/app/chatroom?id=room-a';
const CHATROOM_B = 'https://app.chatroom.dev/app/chatroom?id=room-b';
const OTHER_PAGE = 'https://other.site/page';

describe('decideNotificationClickAction', () => {
  describe('when a matching chatroom tab exists', () => {
    it('returns focus-and-post for the matching client', () => {
      const action = decideNotificationClickAction(
        [makeClient(OTHER_PAGE), makeClient(CHATROOM_A), makeClient(CHATROOM_B)],
        'room-a'
      );
      expect(action).toEqual({
        kind: 'focus-and-post',
        clientIndex: 1,
        chatroomId: 'room-a',
      });
    });

    it('prefers exact match over generic app tab', () => {
      const action = decideNotificationClickAction(
        [makeClient(APP_HOME), makeClient(CHATROOM_B)],
        'room-b'
      );
      expect(action).toEqual({
        kind: 'focus-and-post',
        clientIndex: 1,
        chatroomId: 'room-b',
      });
    });
  });

  describe('when an app tab exists but not the matching chatroom', () => {
    it('returns focus-and-post for the first app tab', () => {
      const action = decideNotificationClickAction(
        [makeClient(OTHER_PAGE), makeClient(APP_HOME), makeClient(CHATROOM_B)],
        'room-a'
      );
      expect(action).toEqual({
        kind: 'focus-and-post',
        clientIndex: 1,
        chatroomId: 'room-a',
      });
    });

    it('omits chatroomId when no chatroomId provided', () => {
      const action = decideNotificationClickAction(
        [makeClient(OTHER_PAGE), makeClient(APP_HOME)],
        undefined
      );
      expect(action).toEqual({
        kind: 'focus-and-post',
        clientIndex: 1,
      });
    });
  });

  describe('when no app tab exists', () => {
    it('returns open-window with chatroom URL when chatroomId provided', () => {
      const action = decideNotificationClickAction([makeClient(OTHER_PAGE)], 'room-a');
      expect(action).toEqual({
        kind: 'open-window',
        url: '/app/chatroom?id=room-a',
      });
    });

    it('returns open-window with generic app URL when no chatroomId', () => {
      const action = decideNotificationClickAction([makeClient(OTHER_PAGE)], undefined);
      expect(action).toEqual({
        kind: 'open-window',
        url: '/app',
      });
    });

    it('falls back to open-window with generic app URL for empty client list', () => {
      const action = decideNotificationClickAction([], 'room-a');
      expect(action).toEqual({
        kind: 'open-window',
        url: '/app/chatroom?id=room-a',
      });
    });
  });

  describe('no `client.navigate` in any output', () => {
    it('never produces a navigate action', () => {
      const results = [
        decideNotificationClickAction([makeClient(CHATROOM_A)], 'room-a'),
        decideNotificationClickAction([makeClient(APP_HOME)], 'room-a'),
        decideNotificationClickAction([makeClient(OTHER_PAGE)], 'room-a'),
        decideNotificationClickAction([], undefined),
      ];
      for (const r of results) {
        expect(r).not.toHaveProperty('navigate');
      }
    });
  });
});
