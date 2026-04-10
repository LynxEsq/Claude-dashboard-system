class DataBatcher {
  constructor(flushFn, { flushInterval = 16, maxBytes = 200 * 1024 } = {}) {
    this.flushFn = flushFn;
    this.flushInterval = flushInterval;
    this.maxBytes = maxBytes;
    this.queue = [];
    this.byteSize = 0;
    this.timer = null;
  }

  push(msg) {
    const str = JSON.stringify(msg);
    this.queue.push(str);
    this.byteSize += str.length;

    if (this.byteSize >= this.maxBytes) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.queue.length === 0) return;

    const batch = this.queue.length === 1 ? this.queue[0] : `[${this.queue.join(',')}]`;
    this.queue = [];
    this.byteSize = 0;
    this.flushFn(batch);
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}

module.exports = DataBatcher;
