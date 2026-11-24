/** jsdom has no media pipeline: give <video>/<audio> just enough behaviour. */
export function installMediaStubs(): void {
  const paused = new WeakMap<HTMLMediaElement, boolean>();
  const time = new WeakMap<HTMLMediaElement, number>();
  const proto = HTMLMediaElement.prototype;
  Object.defineProperty(proto, "paused", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return paused.get(this) ?? true;
    },
  });
  Object.defineProperty(proto, "currentTime", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return time.get(this) ?? 0;
    },
    set(this: HTMLMediaElement, value: number) {
      time.set(this, value);
    },
  });
  Object.defineProperty(proto, "duration", {
    configurable: true,
    get: () => 30,
  });
  proto.play = function (this: HTMLMediaElement) {
    paused.set(this, false);
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  };
  proto.pause = function (this: HTMLMediaElement) {
    paused.set(this, true);
    this.dispatchEvent(new Event("pause"));
  };
  proto.load = () => {};
}
