"use strict";

/* ==========================================================================
   MOTIONSITES CINEMATIC JAVASCRIPT CONTROLLER
   Interactive components for FitTrack Pro Max Landing Page
   ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {

  /* ==========================================================================
     1. 3D-TILT CARD EFFECT WITH SPECULAR SHEEN
     ========================================================================== */
  const cardWrapper = document.getElementById("heroCard3d");
  const glassCard = cardWrapper?.querySelector(".hero-glass-dashboard");
  const sheen = cardWrapper?.querySelector(".card-specular-sheen");

  if (cardWrapper && glassCard) {
    const handleMouseMove = (e) => {
      const rect = cardWrapper.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;

      // Calculate subtle 3D rotation angles (-8deg to +8deg)
      const rotateX = ((y - centerY) / centerY) * -7;
      const rotateY = ((x - centerX) / centerX) * 7;

      glassCard.style.transform = `rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`;

      if (sheen) {
        sheen.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(255,255,255,0.12) 0%, transparent 60%)`;
      }
    };

    const handleMouseLeave = () => {
      glassCard.style.transform = "rotateX(0deg) rotateY(0deg)";
      glassCard.style.transition = "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)";
    };

    const handleMouseEnter = () => {
      glassCard.style.transition = "transform 0.1s ease-out";
    };

    cardWrapper.addEventListener("mousemove", handleMouseMove);
    cardWrapper.addEventListener("mouseleave", handleMouseLeave);
    cardWrapper.addEventListener("mouseenter", handleMouseEnter);
  }


  /* ==========================================================================
     2. INTERACTIVE LIVE STUDIO TABS SWITCHER
     ========================================================================== */
  const studioTabs = document.querySelectorAll(".studio-tab");
  const studioPanels = document.querySelectorAll(".studio-panel");

  studioTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetId = tab.dataset.tab;

      // Update Tab States
      studioTabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle("active", isActive);
        t.setAttribute("aria-selected", String(isActive));
      });

      // Update Panel States
      studioPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.id === targetId);
      });
    });
  });


  /* ==========================================================================
     3. PRICING TIER TOGGLE SWITCH
     ========================================================================== */
  const pricingSwitch = document.getElementById("pricingSwitch");
  const labelMonthly = document.getElementById("labelMonthly");
  const labelPro = document.getElementById("labelPro");
  const proPriceVal = document.getElementById("proPriceVal");
  const proPricePeriod = document.getElementById("proPricePeriod");

  if (pricingSwitch) {
    let isProAnnual = true;

    pricingSwitch.classList.add("active");

    pricingSwitch.addEventListener("click", () => {
      isProAnnual = !isProAnnual;
      pricingSwitch.classList.toggle("active", isProAnnual);
      pricingSwitch.setAttribute("aria-checked", String(isProAnnual));

      if (isProAnnual) {
        labelPro?.classList.add("active");
        labelMonthly?.classList.remove("active");
        if (proPriceVal) proPriceVal.textContent = "0";
        if (proPricePeriod) proPricePeriod.textContent = "/ 100% Free Open Access";
      } else {
        labelMonthly?.classList.add("active");
        labelPro?.classList.remove("active");
        if (proPriceVal) proPriceVal.textContent = "0";
        if (proPricePeriod) proPricePeriod.textContent = "/ Community Open Source";
      }
    });
  }


  /* ==========================================================================
     4. INTERACTIVE BENTO CARD DEMONSTRATION ("LOG SET NOW")
     ========================================================================== */
  const showcaseBtn = document.querySelector(".showcase-log-btn");
  if (showcaseBtn) {
    let clickCount = 0;
    showcaseBtn.addEventListener("click", () => {
      clickCount++;
      showcaseBtn.style.background = "#00f0aa";
      showcaseBtn.innerHTML = `<span>Set ${clickCount} Logged ✓</span>`;
      setTimeout(() => {
        showcaseBtn.style.background = "var(--ms-cyan)";
        showcaseBtn.innerHTML = `
          <span>Log Set Now</span>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
      }, 1400);
    });
  }


  /* ==========================================================================
     5. SMOOTH ANCHOR SCROLLING
     ========================================================================== */
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", (e) => {
      const targetId = anchor.getAttribute("href");
      if (targetId && targetId !== "#") {
        const targetEl = document.querySelector(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: "smooth" });
        }
      }
    });
  });

});
