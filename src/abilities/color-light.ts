import { CharacteristicValue } from 'homebridge';

import { Ability, ServiceClass } from './base';

type RgbTuple = [number, number, number];

type ColorMode = 'rgb' | 'rgbw';

type RgbLikeComponent = {
  id: number;
  key: string;
  output: boolean;
  brightness?: number;
  rgb?: RgbTuple;
  white?: number;
  set: (on?: boolean, brightness?: number, rgb?: RgbTuple, white?: number) => Promise<void>;
  on: (event: string, handler: (value: unknown) => void, ctx?: unknown) => void;
  off: (event: string, handler: (value: unknown) => void, ctx?: unknown) => void;
};

type HsvTuple = { h: number; s: number; v: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const rgbToHsv = (rgb: RgbTuple): HsvTuple => {
  const r = clamp(rgb[0], 0, 255) / 255;
  const g = clamp(rgb[1], 0, 255) / 255;
  const b = clamp(rgb[2], 0, 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h = Math.round(h * 60);
    if (h < 0) {
      h += 360;
    }
  }

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s: Math.round(s * 100), v: Math.round(v * 100) };
};

const hsvToRgb = (h: number, s: number, v: number): RgbTuple => {
  const hue = ((h % 360) + 360) % 360;
  const sat = clamp(s, 0, 100) / 100;
  const val = clamp(v, 0, 100) / 100;

  const c = val * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = val - c;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hue < 60) {
    r1 = c; g1 = x; b1 = 0;
  } else if (hue < 120) {
    r1 = x; g1 = c; b1 = 0;
  } else if (hue < 180) {
    r1 = 0; g1 = c; b1 = x;
  } else if (hue < 240) {
    r1 = 0; g1 = x; b1 = c;
  } else if (hue < 300) {
    r1 = x; g1 = 0; b1 = c;
  } else {
    r1 = c; g1 = 0; b1 = x;
  }

  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
};

export class ColorLightAbility extends Ability {
  private lastHue = 0;
  private lastSaturation = 0;
  private lastBrightness = 100;
  private lastRgb: RgbTuple = [255, 255, 255];
  private lastWhite: number | undefined;

  /**
   * @param component - The rgb/rgbw component to control.
   * @param mode - The color mode (rgb or rgbw).
   */
  constructor(
    readonly component: RgbLikeComponent,
    readonly mode: ColorMode,
  ) {
    super(
      `Light ${component.id + 1}`,
      `color-light-${component.id}`,
    );
  }

  protected get serviceClass(): ServiceClass {
    return this.Service.Lightbulb;
  }

  protected initialize() {
    const rgb = Array.isArray(this.component.rgb) ? this.component.rgb : undefined;
    if (rgb) {
      this.lastRgb = rgb;
      const hsv = rgbToHsv(rgb);
      this.lastHue = hsv.h;
      this.lastSaturation = hsv.s;
      if (this.component.brightness === undefined) {
        this.lastBrightness = hsv.v;
      }
    }

    if (this.component.brightness !== undefined) {
      this.lastBrightness = this.component.brightness;
    }

    if (this.component.white !== undefined) {
      this.lastWhite = this.component.white;
    }

    this.service.setCharacteristic(this.Characteristic.On, this.component.output);
    this.service.setCharacteristic(this.Characteristic.Brightness, this.lastBrightness);
    this.service.setCharacteristic(this.Characteristic.Hue, this.lastHue);
    this.service.setCharacteristic(this.Characteristic.Saturation, this.lastSaturation);

    this.service.getCharacteristic(this.Characteristic.On)
      .onSet(this.onSetHandler.bind(this));
    this.service.getCharacteristic(this.Characteristic.Brightness)
      .onSet(this.brightnessSetHandler.bind(this));
    this.service.getCharacteristic(this.Characteristic.Hue)
      .onSet(this.hueSetHandler.bind(this));
    this.service.getCharacteristic(this.Characteristic.Saturation)
      .onSet(this.saturationSetHandler.bind(this));

    this.component.on('change:output', this.outputChangeHandler, this);
    this.component.on('change:brightness', this.brightnessChangeHandler, this);
    this.component.on('change:rgb', this.rgbChangeHandler, this);
    if (this.mode === 'rgbw') {
      this.component.on('change:white', this.whiteChangeHandler, this);
    }
  }

  detach() {
    this.component.off('change:output', this.outputChangeHandler, this);
    this.component.off('change:brightness', this.brightnessChangeHandler, this);
    this.component.off('change:rgb', this.rgbChangeHandler, this);
    this.component.off('change:white', this.whiteChangeHandler, this);
  }

  /**
   * Handles changes to the Light.On characteristic.
   */
  protected async onSetHandler(value: CharacteristicValue) {
    if (value === this.component.output) {
      return;
    }

    try {
      await this.component.set(value as boolean);
    } catch (e) {
      this.log.error(
        'Failed to set color light:',
        e instanceof Error ? e.message : e,
      );
      throw this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE;
    }
  }

  /**
   * Handles changes to the Light.Brightness characteristic.
   */
  protected async brightnessSetHandler(value: CharacteristicValue) {
    if (value === this.component.brightness) {
      return;
    }

    this.lastBrightness = value as number;

    try {
      await this.component.set(undefined, value as number);
    } catch (e) {
      this.log.error(
        'Failed to set color light brightness:',
        e instanceof Error ? e.message : e,
      );
      throw this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE;
    }
  }

  /**
   * Handles changes to the Light.Hue characteristic.
   */
  protected async hueSetHandler(value: CharacteristicValue) {
    this.lastHue = value as number;
    await this.setColorFromHsv();
  }

  /**
   * Handles changes to the Light.Saturation characteristic.
   */
  protected async saturationSetHandler(value: CharacteristicValue) {
    this.lastSaturation = value as number;
    await this.setColorFromHsv();
  }

  protected async setColorFromHsv() {
    const rgb = hsvToRgb(this.lastHue, this.lastSaturation, 100);
    this.lastRgb = rgb;

    try {
      await this.component.set(
        undefined,
        undefined,
        rgb,
        this.lastWhite,
      );
    } catch (e) {
      this.log.error(
        'Failed to set color light color:',
        e instanceof Error ? e.message : e,
      );
      throw this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE;
    }
  }

  /**
   * Handles changes to the `output` property.
   */
  protected outputChangeHandler(value: unknown) {
    this.service.getCharacteristic(this.Characteristic.On)
      .updateValue(value as boolean);
  }

  /**
   * Handles changes to the `brightness` property.
   */
  protected brightnessChangeHandler(value: unknown) {
    this.lastBrightness = value as number;
    this.service.getCharacteristic(this.Characteristic.Brightness)
      .updateValue(value as number);
  }

  /**
   * Handles changes to the `rgb` property.
   */
  protected rgbChangeHandler(value: unknown) {
    const rgb = value as RgbTuple;
    this.lastRgb = rgb;

    const hsv = rgbToHsv(rgb);
    this.lastHue = hsv.h;
    this.lastSaturation = hsv.s;

    this.service.getCharacteristic(this.Characteristic.Hue)
      .updateValue(this.lastHue);
    this.service.getCharacteristic(this.Characteristic.Saturation)
      .updateValue(this.lastSaturation);

    if (this.component.brightness === undefined) {
      this.lastBrightness = hsv.v;
      this.service.getCharacteristic(this.Characteristic.Brightness)
        .updateValue(this.lastBrightness);
    }
  }

  /**
   * Handles changes to the `white` property.
   */
  protected whiteChangeHandler(value: unknown) {
    this.lastWhite = value as number;
  }
}
