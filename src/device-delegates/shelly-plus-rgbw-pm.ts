import type { ComponentLike } from 'shellies-ds9';

import { DeviceDelegate } from './base';

/**
 * Handles Shelly Plus RGBW PM devices.
 */
export class ShellyPlusRGBWPMDelegate extends DeviceDelegate {
  protected setup() {
    const d = this.device as {
      rgb0?: unknown;
      rgbw0?: unknown;
      light0?: unknown;
      light1?: unknown;
      light2?: unknown;
      light3?: unknown;
    };

    if (d.rgbw0) {
      this.addColorLight(d.rgbw0 as unknown as ComponentLike, { single: true, mode: 'rgbw' });
      return;
    }

    if (d.rgb0) {
      this.addColorLight(d.rgb0 as unknown as ComponentLike, { single: true, mode: 'rgb' });
      return;
    }

    const lights = [d.light0, d.light1, d.light2, d.light3].filter(Boolean);
    if (lights.length === 1) {
      this.addLight(lights[0] as never, { single: true });
      return;
    }

    for (const light of lights) {
      this.addLight(light as never);
    }
  }
}

DeviceDelegate.registerDelegate(
  ShellyPlusRGBWPMDelegate,
  { model: 'SNDC-0D4P10WW' },
);
