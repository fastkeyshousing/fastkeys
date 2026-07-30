/* FastKeys — shared behaviour for index.html and nl/index.html */
(function(){
  "use strict";

  var lang = document.documentElement.lang === 'nl' ? 'nl' : 'en';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var yr = document.getElementById('yr');
  if(yr) yr.textContent = new Date().getFullYear();

  /* ---- nav ---- */
  var nav = document.getElementById('nav');
  var burger = document.getElementById('burger');
  var links = document.getElementById('navlinks');
  var labels = lang === 'nl'
    ? {open:'Menu openen', close:'Menu sluiten'}
    : {open:'Open menu',  close:'Close menu'};

  burger.addEventListener('click', function(){
    var open = links.classList.toggle('open');
    burger.setAttribute('aria-expanded', open);
    burger.setAttribute('aria-label', open ? labels.close : labels.open);
  });
  links.addEventListener('click', function(e){
    if(e.target.tagName === 'A'){
      links.classList.remove('open');
      burger.setAttribute('aria-expanded','false');
      burger.setAttribute('aria-label', labels.open);
    }
  });

  /* ---- ticker: the messages an international house hunter actually gets ---- */
  var LINES = {
    en: [
      "Sorry, it's already rented",
      "Alleen Nederlandssprekende studenten",
      "Transfer the deposit today to hold it",
      "No registration possible at this address",
      "Viewing tomorrow at 14:00 — can you come?",
      "€350 agency fee before we show you anything",
      "Huurcontract in Dutch only, no translation",
      "48 people already responded to this room",
      "Girls only, non-smoker, Dutch speaker preferred",
      "Photos are from the last tenant"
    ],
    nl: [
      "Sorry, al verhuurd",
      "Alleen Nederlandssprekende studenten",
      "Maak vandaag de borg over om de kamer vast te houden",
      "Inschrijven op dit adres is niet mogelijk",
      "Bezichtiging morgen om 14:00 — kun je erbij zijn?",
      "€350 bemiddelingskosten voordat we iets laten zien",
      "Huurcontract alleen in het Nederlands",
      "48 mensen reageerden al op deze kamer",
      "Alleen meiden, niet-roker, bij voorkeur Nederlands",
      "Foto's zijn van de vorige huurder"
    ]
  };
  var track = document.getElementById('track');
  if(track){
    var html = LINES[lang].map(function(l){ return '<span>' + l + '</span>'; }).join('');
    track.innerHTML = html + html;
  }

  /* ---- scroll reveal ---- */
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if(en.isIntersecting){
        var t = en.target;
        t.classList.add('seen');
        setTimeout(function(){ t.style.transitionDelay = ''; }, 1100);
        io.unobserve(t);
      }
    });
  }, {threshold:.16, rootMargin:'0px 0px -8% 0px'});
  document.querySelectorAll('[data-rev]').forEach(function(el, i){
    el.style.transitionDelay = (i % 4) * 70 + 'ms';
    io.observe(el);
  });

  /* ---- steps: each number lights up as you reach it ---- */
  var stepIO = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting) en.target.classList.add('seen'); });
  }, {threshold:.5});
  document.querySelectorAll('.step').forEach(function(s){ stepIO.observe(s); });

  /* ---- steps: the gold thread follows the scroll ---- */
  var steps  = document.getElementById('steps');
  var thread = document.getElementById('thread');
  var wa     = document.getElementById('wa');
  var hero   = document.getElementById('top');
  var ticking = false;

  function onFrame(){
    if(steps && thread){
      var r = steps.getBoundingClientRect();
      var p = (window.innerHeight * 0.72 - r.top) / r.height;
      thread.style.height = Math.max(0, Math.min(1, p)) * 100 + '%';
    }
    if(wa && hero){
      wa.classList.toggle('show', window.scrollY > hero.offsetHeight * 0.6);
    }
    ticking = false;
  }
  window.addEventListener('scroll', function(){
    nav.classList.toggle('stuck', window.scrollY > 12);
    if(!ticking){ ticking = true; requestAnimationFrame(onFrame); }
  }, {passive:true});
  onFrame();

  /* ---- faq ---- */
  document.querySelectorAll('.faq-q').forEach(function(q){
    q.addEventListener('click', function(){
      var open = q.parentElement.classList.toggle('open');
      q.setAttribute('aria-expanded', open);
    });
  });

  /* ---- signature: the search, played out ---- */
  var msgs = Array.prototype.slice.call(document.querySelectorAll('.msg'));
  var keys = document.getElementById('keysCard');
  var sleep = function(ms){ return new Promise(function(r){ setTimeout(r, ms); }); };

  if(!keys) return;

  if(reduced){
    keys.classList.add('in');
  } else {
    (async function loop(){
      while(true){
        for(var i = 0; i < msgs.length; i++){
          msgs[i].classList.add('in');
          await sleep(680);
        }
        await sleep(1700);
        msgs.forEach(function(m, i){
          setTimeout(function(){ m.classList.remove('in'); m.classList.add('out'); }, i * 90);
        });
        await sleep(900);
        keys.classList.add('in');
        await sleep(4800);
        keys.classList.remove('in');
        await sleep(700);
        msgs.forEach(function(m){ m.classList.remove('out'); });
        await sleep(400);
      }
    })();
  }
})();
