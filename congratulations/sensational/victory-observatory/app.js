(function () {
  "use strict";

  var palette = ["#ffc83d", "#dfff45", "#68e7e1", "#ff5c35", "#ff4f9a", "#f4f0e7"];
  var stage = document.querySelector(".stage");
  var orbitTicks = document.querySelector(".orbit-ticks");
  var sparkLayer = document.querySelector(".spark-layer");
  var confettiLayer = document.querySelector(".confetti-layer");
  var replayButton = document.querySelector(".replay");
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var master;

  document.querySelectorAll(".title-row").forEach(function (row) {
    row.getAttribute("data-text").split("").forEach(function (character) {
      var span = document.createElement("span");
      span.className = "letter";
      span.textContent = character;
      span.setAttribute("aria-hidden", "true");
      row.appendChild(span);
    });
  });

  function buildOrbitTicks() {
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < 48; i += 1) {
      var tick = document.createElement("i");
      tick.className = "orbit-tick";
      tick.style.transform = "rotate(" + (i * 7.5) + "deg)";
      fragment.appendChild(tick);
    }
    orbitTicks.appendChild(fragment);
  }

  function buildSparks() {
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < 72; i += 1) {
      var spark = document.createElement("i");
      spark.className = "spark";
      spark.style.setProperty("--size", gsap.utils.random(2, 7, true) + "px");
      spark.style.setProperty("--spark-color", palette[i % palette.length]);
      fragment.appendChild(spark);
    }
    sparkLayer.appendChild(fragment);
  }

  function buildConfetti() {
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < 160; i += 1) {
      var piece = document.createElement("i");
      piece.className = "confetti";
      piece.style.setProperty("--start-x", gsap.utils.random(4, 96, true) + "%");
      piece.style.setProperty("--start-y", gsap.utils.random(-12, 6, true) + "%");
      piece.style.setProperty("--w", gsap.utils.random(4, 11, true) + "px");
      piece.style.setProperty("--h", gsap.utils.random(10, 30, true) + "px");
      piece.style.setProperty("--color", palette[i % palette.length]);
      fragment.appendChild(piece);
    }
    confettiLayer.appendChild(fragment);
  }

  function launchSparks() {
    document.querySelectorAll(".spark").forEach(function (spark, index) {
      var angle = (Math.PI * 2 * index) / 72 + gsap.utils.random(-0.09, 0.09);
      var distance = gsap.utils.random(130, Math.max(260, Math.min(window.innerWidth, window.innerHeight) * 0.52));
      var x = Math.cos(angle) * distance;
      var y = Math.sin(angle) * distance;
      gsap.fromTo(spark,
        { x: 0, y: 0, scale: 0.2, opacity: 0 },
        { x: x, y: y, scale: gsap.utils.random(0.7, 1.7), opacity: 1, duration: 0.7, delay: (index % 12) * 0.012, ease: "power4.out" }
      );
      gsap.to(spark, { opacity: 0, scale: 0.1, duration: 0.65, delay: 0.62 + (index % 12) * 0.012, ease: "power2.out" });
    });
  }

  function rainConfetti() {
    document.querySelectorAll(".confetti").forEach(function (piece, index) {
      var horizontal = gsap.utils.random(-180, 180);
      var fall = window.innerHeight + gsap.utils.random(100, 480);
      var delay = (index % 40) * 0.025;
      gsap.fromTo(piece,
        { x: 0, y: -60, rotate: gsap.utils.random(-120, 120), scale: 0.3, opacity: 0 },
        {
          x: horizontal,
          y: fall,
          rotate: gsap.utils.random(420, 1560),
          scale: gsap.utils.random(0.65, 1.45),
          opacity: 1,
          duration: gsap.utils.random(2.4, 4.6),
          delay: delay,
          ease: "power1.out"
        }
      );
      gsap.to(piece, { opacity: 0, duration: 0.6, delay: delay + gsap.utils.random(2.0, 3.8), ease: "power1.out" });
    });
  }

  function startAmbientMotion() {
    if (reducedMotion) return;
    gsap.to(".orbit--outer", { rotate: 360, duration: 55, repeat: -1, ease: "linear" });
    gsap.to(".orbit--middle", { rotate: -360, duration: 34, repeat: -1, ease: "linear" });
    gsap.to(".orbit--inner", { rotate: 360, duration: 21, repeat: -1, ease: "linear" });
    gsap.to(".orbit-ticks", { rotate: -360, duration: 70, repeat: -1, ease: "linear" });
    gsap.to(".core-medal", { y: -10, rotate: 5, duration: 2.6, repeat: -1, yoyo: true, ease: "power2.inOut" });
    gsap.to(".core-glow", { scale: 1.14, opacity: 0.64, duration: 2.2, repeat: -1, yoyo: true, ease: "power2.inOut" });
    gsap.to(".spotlight--one", { rotate: -4, duration: 4.8, repeat: -1, yoyo: true, ease: "power2.inOut" });
    gsap.to(".spotlight--two", { rotate: 7, duration: 5.6, repeat: -1, yoyo: true, ease: "power2.inOut" });
    gsap.to(".spotlight--three", { rotate: -3, duration: 5.1, repeat: -1, yoyo: true, ease: "power2.inOut" });
    gsap.to(".ticker-track", { x: -480, duration: 14, repeat: -1, ease: "linear" });
    gsap.fromTo(".ticker-track--reverse", { x: -460 }, { x: 0, duration: 16, repeat: -1, ease: "linear" });
    gsap.to(".signal-dot", { scale: 1.55, opacity: 0.38, duration: 0.85, repeat: -1, yoyo: true, ease: "power2.inOut" });
  }

  function createTimeline() {
    var travelX = window.innerWidth * 0.58;
    var travelY = window.innerHeight * 0.58;
    return gsap.timeline({ paused: true, defaults: { ease: "power4.out" } })
      .fromTo(".aperture-blade--top", { y: 0 }, { y: -travelY, duration: 0.86 }, 0.02)
      .fromTo(".aperture-blade--bottom", { y: 0 }, { y: travelY, duration: 0.86 }, 0.02)
      .fromTo(".aperture-blade--left", { x: 0 }, { x: -travelX, duration: 0.92 }, 0.08)
      .fromTo(".aperture-blade--right", { x: 0 }, { x: travelX, duration: 0.92 }, 0.08)
      .fromTo(".arena", { scale: 0.44, rotate: -12, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 1.15, ease: "back.out(1.7)" }, 0.22)
      .fromTo(".orbit", { scale: 0.25, opacity: 0 }, { scale: 1, opacity: 1, duration: 1.1, stagger: 0.1 }, 0.28)
      .fromTo(".orbit-tick", { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 0.65, duration: 0.52, stagger: { each: 0.009, from: "center" } }, 0.36)
      .fromTo(".core-medal", { scale: 0, rotate: -190, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.86, ease: "back.out(1.7)" }, 0.58)
      .fromTo(".eyebrow-code", { x: -48, opacity: 0 }, { x: 0, opacity: 1, duration: 0.52 }, 0.56)
      .fromTo(".eyebrow-line", { scaleX: 0 }, { scaleX: 1, duration: 0.7 }, 0.6)
      .fromTo(".eyebrow-copy", { x: 48, opacity: 0 }, { x: 0, opacity: 1, duration: 0.52 }, 0.64)
      .fromTo(".title-row--one .letter", { y: 190, rotate: 11, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 0.72, stagger: 0.052 }, 0.66)
      .fromTo(".title-row--two .letter", { y: -210, rotate: -10, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 0.8, stagger: { each: 0.048, from: "end" } }, 0.82)
      .fromTo(".title-row--bang .letter", { scale: 0, rotate: -70, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.48, stagger: 0.09, ease: "back.out(1.7)" }, 1.22)
      .fromTo(".ribbon--left", { x: -420, opacity: 0 }, { x: 0, opacity: 1, duration: 0.76 }, 1.04)
      .fromTo(".ribbon--right", { x: 420, opacity: 0 }, { x: 0, opacity: 1, duration: 0.76 }, 1.12)
      .fromTo(".message-panel", { y: 72, rotateX: -18, opacity: 0 }, { y: 0, rotateX: 0, opacity: 1, duration: 0.82, ease: "back.out(1.7)" }, 1.28)
      .fromTo(".message-panel__mark", { scaleX: 0 }, { scaleX: 1, duration: 0.54 }, 1.38)
      .fromTo(".message-panel__lead, .message-panel__copy", { x: 30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.58, stagger: 0.08 }, 1.48)
      .fromTo(".controls", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.56 }, 1.56)
      .fromTo(".ticker", { opacity: 0 }, { opacity: 1, duration: 0.42, stagger: 0.08 }, 1.62)
      .fromTo(".flash", { opacity: 0 }, { opacity: 0.9, duration: 0.055 }, 1.7)
      .to(".flash", { opacity: 0, duration: 0.32 }, 1.755)
      .add(launchSparks, 1.7)
      .add(rainConfetti, 1.76);
  }

  function cancelAnimations() {
    document.querySelectorAll(".stage *").forEach(function (element) {
      element.getAnimations().forEach(function (animation) { animation.cancel(); });
    });
  }

  function replay() {
    cancelAnimations();
    master = createTimeline();
    master.play();
    startAmbientMotion();
  }

  function handlePointer(event) {
    var x = (event.clientX / window.innerWidth - 0.5) * 18;
    var y = (event.clientY / window.innerHeight - 0.5) * 14;
    stage.style.setProperty("--pointer-x", x.toFixed(2) + "px");
    stage.style.setProperty("--pointer-y", y.toFixed(2) + "px");
  }

  buildOrbitTicks();
  buildSparks();
  buildConfetti();
  replay();
  replayButton.addEventListener("click", replay);
  if (!reducedMotion) window.addEventListener("pointermove", handlePointer, { passive: true });
})();
