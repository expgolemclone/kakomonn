(function () {
  "use strict";

  var colors = ["#e9ff3d", "#ff4f1f", "#2356ff", "#ff4db8", "#fffaf0", "#11100e"];
  var confettiLayer = document.querySelector(".confetti-layer");
  var burst = document.querySelector(".burst");
  var replayButton = document.querySelector(".replay");
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

  function buildBurst() {
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < 32; i += 1) {
      var ray = document.createElement("i");
      ray.className = "burst-ray";
      ray.style.transform = "rotate(" + (i * 11.25) + "deg)";
      fragment.appendChild(ray);
    }
    burst.appendChild(fragment);
  }

  function buildConfetti() {
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < 120; i += 1) {
      var piece = document.createElement("i");
      var leftSide = i % 2 === 0;
      piece.className = "confetti";
      piece.style.setProperty("--start-x", leftSide ? "8%" : "92%");
      piece.style.setProperty("--start-y", gsap.utils.random(46, 84, true) + "%");
      piece.style.setProperty("--w", gsap.utils.random(5, 13, true) + "px");
      piece.style.setProperty("--h", gsap.utils.random(8, 26, true) + "px");
      piece.style.setProperty("--radius", Math.random() > 0.82 ? "50%" : "0");
      piece.style.setProperty("--color", colors[i % colors.length]);
      piece.setAttribute("data-side", leftSide ? "left" : "right");
      fragment.appendChild(piece);
    }
    confettiLayer.appendChild(fragment);
  }

  function burstConfetti() {
    document.querySelectorAll(".confetti").forEach(function (piece, index) {
      var fromLeft = piece.getAttribute("data-side") === "left";
      var x = gsap.utils.random(140, Math.max(320, window.innerWidth * 0.62));
      if (!fromLeft) x *= -1;
      var y = gsap.utils.random(-360, -100);
      var delay = (index % 20) * 0.012;

      gsap.fromTo(piece,
        { x: 0, y: 0, rotate: gsap.utils.random(-90, 90), scale: 0.25, opacity: 0 },
        {
          x: x,
          y: y,
          rotate: gsap.utils.random(280, 980),
          scale: gsap.utils.random(0.75, 1.4),
          opacity: 1,
          duration: gsap.utils.random(1.2, 1.9),
          delay: delay,
          ease: "power4.out"
        }
      );

      gsap.fromTo(piece,
        { x: x, y: y, opacity: 1 },
        {
          x: x + gsap.utils.random(-80, 80),
          y: y + gsap.utils.random(380, 720),
          rotate: gsap.utils.random(800, 1500),
          opacity: 0,
          duration: gsap.utils.random(1.4, 2.3),
          delay: delay + 1.05,
          ease: "power1.out"
        }
      );
    });
  }

  function ambientMotion() {
    gsap.to(".sun-ring--one", { rotate: 360, duration: 28, repeat: -1, ease: "linear" });
    gsap.to(".sun-ring--two", { rotate: -360, duration: 42, repeat: -1, ease: "linear" });
    gsap.to(".seal", { y: -10, rotate: -4, duration: 2.8, repeat: -1, yoyo: true, ease: "power2.inOut" });
    gsap.to(".seal-orbit", { rotate: 360, duration: 18, repeat: -1, ease: "linear" });
    gsap.to(".edge-copy--left", { x: 44, duration: 4.2, repeat: -1, yoyo: true, ease: "power2.inOut" });
    gsap.to(".edge-copy--right", { x: -44, duration: 4.6, repeat: -1, yoyo: true, ease: "power2.inOut" });
  }

  function createTimeline() {
    return gsap.timeline({ defaults: { ease: "power4.out" }, paused: true })
      .fromTo(".curtain--left", { x: 0 }, { x: -window.innerWidth * 0.55, duration: 0.88 }, 0.05)
      .fromTo(".curtain--right", { x: 0 }, { x: window.innerWidth * 0.55, duration: 0.88 }, 0.05)
      .fromTo(".sun-disc", { scale: 0.1, rotate: -20, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.92, ease: "back.out(1.7)" }, 0.28)
      .fromTo(".sun-ring", { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 0.34, duration: 1.15, stagger: 0.1 }, 0.36)
      .fromTo(".burst-ray", { scaleY: 0, opacity: 0 }, { scaleY: 1, opacity: 0.7, duration: 0.7, stagger: { each: 0.009, from: "center" } }, 0.42)
      .fromTo(".topline-index", { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.55 }, 0.52)
      .fromTo(".topline-rule", { scaleX: 0 }, { scaleX: 1, duration: 0.75 }, 0.56)
      .fromTo(".topline-copy", { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.55 }, 0.62)
      .fromTo(".title-row:first-child .letter", { y: 180, rotate: 8, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 0.78, stagger: 0.045 }, 0.64)
      .fromTo(".title-row--accent .letter", { y: -180, rotate: -8, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 0.82, stagger: { each: 0.04, from: "end" } }, 0.78)
      .fromTo(".seal", { scale: 0, rotate: -140, opacity: 0 }, { scale: 1, rotate: -10, opacity: 1, duration: 0.82, ease: "back.out(1.7)" }, 1.12)
      .fromTo(".statement-lead", { x: -70, skewX: -12, opacity: 0 }, { x: 0, skewX: 0, opacity: 1, duration: 0.68 }, 1.22)
      .fromTo(".statement-copy", { x: 70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.68 }, 1.3)
      .fromTo(".footer-row", { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, 1.42)
      .fromTo(".edge-copy", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 1.48)
      .fromTo(".flash", { opacity: 0 }, { opacity: 0.88, duration: 0.06 }, 1.5)
      .to(".flash", { opacity: 0, duration: 0.36 }, 1.56)
      .add(burstConfetti, 1.5);
  }

  function cancelEntranceAnimations() {
    document.querySelectorAll(".curtain, .sun-disc, .sun-ring, .burst-ray, .topline-index, .topline-rule, .topline-copy, .letter, .seal, .statement-lead, .statement-copy, .footer-row, .edge-copy, .flash, .confetti")
      .forEach(function (element) {
        element.getAnimations().forEach(function (animation) { animation.cancel(); });
      });
  }

  function replay() {
    cancelEntranceAnimations();
    master = createTimeline();
    master.play();
  }

  buildBurst();
  buildConfetti();
  ambientMotion();
  replay();
  replayButton.addEventListener("click", replay);
})();
