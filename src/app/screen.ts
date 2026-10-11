/**
 * Whether this page is showing a shared reading on a flat screen (a phone or
 * computer watching a room) instead of in a headset. Systems read it to hide
 * headset-only panels and to show the table and surroundings without XR.
 */

import { signal } from '@iwsdk/core';

export const onScreen = signal(false);

/**
 * Which page a flat screen shows: the welcome page (start in a headset, or
 * watch a friend's reading), the room-code form, or the reading being watched.
 */
export const screenPage = signal<'welcome' | 'join' | 'watching'>('welcome');
