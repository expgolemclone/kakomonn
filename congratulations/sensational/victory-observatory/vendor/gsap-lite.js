/*
 * Small GSAP-compatible animation surface for this offline demo.
 * It is not the GreenSock GSAP source code and it is not a full replacement.
 */
(function (global) {
  "use strict";

  var reserved = new Set([
    "duration", "delay", "ease", "stagger", "repeat", "repeatDelay", "yoyo",
    "onStart", "onUpdate", "onComplete", "transformOrigin", "clearProps"
  ]);

  var easeMap = {
    none: "linear",
    linear: "linear",
    "power1.out": "cubic-bezier(.25,.46,.45,.94)",
    "power2.out": "cubic-bezier(.22,.61,.36,1)",
    "power3.out": "cubic-bezier(.16,1,.3,1)",
    "power4.out": "cubic-bezier(.12,.84,.2,1)",
    "power2.inOut": "cubic-bezier(.65,0,.35,1)",
    "expo.out": "cubic-bezier(.19,1,.22,1)",
    "back.out(1.7)": "cubic-bezier(.34,1.56,.64,1)",
    "elastic.out(1, 0.5)": "cubic-bezier(.2,1.7,.36,1)"
  };

  function toArray(targets) {
    if (typeof targets === "string") return Array.from(document.querySelectorAll(targets));
    if (targets instanceof Element || targets === window || targets === document) return [targets];
    if (targets && typeof targets.length === "number") return Array.from(targets);
    return targets ? [targets] : [];
  }

  function transformFrom(vars) {
    var parts = [];
    if (vars.x != null || vars.y != null || vars.z != null) {
      parts.push("translate3d(" + (vars.x || 0) + "px," + (vars.y || 0) + "px," + (vars.z || 0) + "px)");
    }
    if (vars.rotate != null) parts.push("rotate(" + vars.rotate + "deg)");
    if (vars.rotateX != null) parts.push("rotateX(" + vars.rotateX + "deg)");
    if (vars.rotateY != null) parts.push("rotateY(" + vars.rotateY + "deg)");
    if (vars.skewX != null) parts.push("skewX(" + vars.skewX + "deg)");
    if (vars.scale != null) parts.push("scale(" + vars.scale + ")");
    if (vars.scaleX != null) parts.push("scaleX(" + vars.scaleX + ")");
    if (vars.scaleY != null) parts.push("scaleY(" + vars.scaleY + ")");
    return parts.join(" ");
  }

  function frameFrom(vars) {
    var frame = {};
    Object.keys(vars || {}).forEach(function (key) {
      if (reserved.has(key)) return;
      if (["x", "y", "z", "rotate", "rotateX", "rotateY", "skewX", "scale", "scaleX", "scaleY"].includes(key)) return;
      if (key === "autoAlpha") {
        frame.opacity = vars[key];
        return;
      }
      frame[key] = vars[key];
    });
    var transform = transformFrom(vars || {});
    if (transform) frame.transform = transform;
    if (vars && vars.transformOrigin) frame.transformOrigin = vars.transformOrigin;
    return frame;
  }

  function applyFrame(el, frame) {
    Object.keys(frame).forEach(function (key) {
      var value = frame[key];
      if (key.startsWith("--")) el.style.setProperty(key, value);
      else el.style[key] = typeof value === "number" && !["opacity", "zIndex", "fontWeight"].includes(key) ? value + "px" : value;
    });
  }

  function currentFrame(el, endFrame) {
    var computed = getComputedStyle(el);
    var start = {};
    Object.keys(endFrame).forEach(function (key) {
      if (key === "transform") start.transform = computed.transform === "none" ? "none" : computed.transform;
      else if (key === "transformOrigin") start.transformOrigin = computed.transformOrigin;
      else start[key] = computed[key];
    });
    return start;
  }

  function staggerDelay(stagger, index, count) {
    if (stagger == null) return 0;
    if (typeof stagger === "number") return stagger * index;
    var each = Number(stagger.each || 0);
    if (stagger.from === "center") {
      var center = (count - 1) / 2;
      return Math.abs(index - center) * each;
    }
    if (stagger.from === "end") return (count - 1 - index) * each;
    return index * each;
  }

  function animateTargets(targets, fromVars, toVars, baseDelay) {
    var elements = toArray(targets);
    var animations = [];
    var duration = Number(toVars.duration == null ? 0.5 : toVars.duration) * 1000;
    var base = (Number(toVars.delay || 0) + Number(baseDelay || 0)) * 1000;
    var repeat = Number(toVars.repeat || 0);
    var iterations = repeat < 0 ? Infinity : repeat + 1;
    var endFrame = frameFrom(toVars);

    elements.forEach(function (el, index) {
      var startFrame = fromVars ? frameFrom(fromVars) : currentFrame(el, endFrame);
      if (fromVars) applyFrame(el, startFrame);
      var delay = base + staggerDelay(toVars.stagger, index, elements.length) * 1000;
      var animation = el.animate([startFrame, endFrame], {
        duration: Math.max(1, duration),
        delay: delay,
        easing: easeMap[toVars.ease] || toVars.ease || easeMap["power1.out"],
        fill: "forwards",
        iterations: iterations,
        direction: toVars.yoyo ? "alternate" : "normal",
        iterationStart: 0
      });
      if (typeof toVars.onStart === "function") {
        setTimeout(function () { toVars.onStart.call(el); }, delay);
      }
      if (typeof toVars.onComplete === "function" && iterations !== Infinity) {
        animation.finished.then(function () { toVars.onComplete.call(el); }).catch(function () {});
      }
      animations.push(animation);
    });

    return {
      animations: animations,
      kill: function () { animations.forEach(function (animation) { animation.cancel(); }); },
      play: function () { animations.forEach(function (animation) { animation.play(); }); },
      pause: function () { animations.forEach(function (animation) { animation.pause(); }); }
    };
  }

  function parsePosition(position, cursor, recentStart, recentEnd, labels) {
    if (position == null) return cursor;
    if (typeof position === "number") return position;
    if (labels[position] != null) return labels[position];
    if (position === "<") return recentStart;
    if (position === ">") return recentEnd;
    var match = String(position).match(/^([<>])([+-]=)?([\d.]+)?$/);
    if (match) {
      var anchor = match[1] === "<" ? recentStart : recentEnd;
      var value = Number(match[3] || 0);
      if (match[2] === "-=") return anchor - value;
      return anchor + value;
    }
    var relative = String(position).match(/^([+-]=)([\d.]+)$/);
    if (relative) return cursor + (relative[1] === "-=" ? -1 : 1) * Number(relative[2]);
    return cursor;
  }

  function Timeline(options) {
    this.options = options || {};
    this.defaults = this.options.defaults || {};
    this.items = [];
    this.labels = {};
    this.cursor = 0;
    this.recentStart = 0;
    this.recentEnd = 0;
    this.handles = [];
    this.playing = false;
    if (!this.options.paused) {
      var self = this;
      queueMicrotask(function () { self.play(); });
    }
  }

  Timeline.prototype._add = function (kind, targets, fromVars, toVars, position) {
    var merged = Object.assign({}, this.defaults, toVars || {});
    var start = parsePosition(position, this.cursor, this.recentStart, this.recentEnd, this.labels);
    var stagger = merged.stagger;
    var count = toArray(targets).length;
    var staggerTail = count > 1 ? staggerDelay(stagger, count - 1, count) : 0;
    var duration = Number(merged.duration == null ? 0.5 : merged.duration);
    var end = start + Number(merged.delay || 0) + duration + staggerTail;
    this.items.push({ kind: kind, targets: targets, fromVars: fromVars, toVars: merged, start: start });
    this.recentStart = start;
    this.recentEnd = end;
    this.cursor = Math.max(this.cursor, end);
    return this;
  };

  Timeline.prototype.to = function (targets, vars, position) {
    return this._add("to", targets, null, vars, position);
  };

  Timeline.prototype.fromTo = function (targets, fromVars, toVars, position) {
    return this._add("fromTo", targets, fromVars, toVars, position);
  };

  Timeline.prototype.set = function (targets, vars, position) {
    return this._add("set", targets, vars, Object.assign({}, vars, { duration: 0.001 }), position);
  };

  Timeline.prototype.addLabel = function (name, position) {
    this.labels[name] = parsePosition(position, this.cursor, this.recentStart, this.recentEnd, this.labels);
    return this;
  };

  Timeline.prototype.add = function (callback, position) {
    var start = parsePosition(position, this.cursor, this.recentStart, this.recentEnd, this.labels);
    this.items.push({ kind: "callback", callback: callback, start: start });
    this.cursor = Math.max(this.cursor, start);
    return this;
  };

  Timeline.prototype.play = function () {
    if (this.playing) return this;
    this.playing = true;
    var self = this;
    this.items.forEach(function (item) {
      if (item.kind === "callback") {
        var timer = setTimeout(item.callback, item.start * 1000);
        self.handles.push({ kill: function () { clearTimeout(timer); } });
      } else {
        self.handles.push(animateTargets(item.targets, item.fromVars, item.toVars, item.start));
      }
    });
    return this;
  };

  Timeline.prototype.kill = function () {
    this.handles.forEach(function (handle) { handle.kill(); });
    this.handles = [];
    this.playing = false;
    return this;
  };

  Timeline.prototype.restart = function () {
    this.kill();
    toArray(".confetti").forEach(function (el) {
      el.getAnimations().forEach(function (animation) { animation.cancel(); });
    });
    return this.play();
  };

  var gsap = {
    set: function (targets, vars) {
      toArray(targets).forEach(function (el) { applyFrame(el, frameFrom(vars)); });
      return targets;
    },
    to: function (targets, vars) { return animateTargets(targets, null, vars, 0); },
    fromTo: function (targets, fromVars, toVars) { return animateTargets(targets, fromVars, toVars, 0); },
    timeline: function (options) { return new Timeline(options); },
    utils: {
      random: function (min, max, round) {
        var value = min + Math.random() * (max - min);
        return round ? Math.round(value) : value;
      }
    }
  };

  global.gsap = gsap;
})(window);
