/**
 * Whether this page is showing a shared reading on a flat screen (a phone or
 * computer watching a room) instead of in a headset. Systems read it to hide
 * headset-only panels and to show the table and surroundings without XR.
 */

import { signal } from '@iwsdk/core';

export const onScreen = signal(false);
