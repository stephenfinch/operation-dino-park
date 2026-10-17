// Hand-drawn SVG icons for the HUD medallions. viewBox 0 0 48 48, coloured with currentColor.
const svg = (body) => `<svg viewBox="0 0 48 48" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;

export const ICON = {
  hardhat: svg('<path stroke="none" d="M8 31c0-9 6-16 16-16s16 7 16 16z"/><path stroke="none" d="M5 31h38v4H5z"/><path fill="none" stroke-width="2.5" d="M24 15v-3M18 17l2 12M30 17l-2 12" opacity=".45"/>'),
  paper: svg('<path stroke="none" d="M10 9h26v30H10z" opacity=".95"/><path fill="none" stroke="#2a3a24" stroke-width="2.2" d="M14 15h18M14 20h8M14 25h8M14 30h18M14 34h18"/><path stroke="none" fill="#2a3a24" d="M25 19h7v8h-7z"/><path stroke="none" d="M36 13h3v24a3 3 0 0 1-3 3z" opacity=".7"/>'),
  skull: svg('<path stroke="none" d="M7 22c2-8 10-12 19-11 7 1 13 5 15 11l-3 2 2 5-6 1-2 4-5-2-3 4-4-3-5 1-1-5-6-2 3-3z"/><circle cx="31" cy="20" r="3" fill="#2a3a24" stroke="none"/><path fill="none" stroke="#2a3a24" stroke-width="1.6" d="M14 26l3 3 3-3 3 3 3-3 3 3"/>'),
  hand: svg('<path stroke="none" d="M14 26V14a2.5 2.5 0 0 1 5 0v9V10a2.5 2.5 0 0 1 5 0v13V12a2.5 2.5 0 0 1 5 0v12-8a2.5 2.5 0 0 1 5 0v14c0 8-5 12-11 12-5 0-8-3-11-8l-5-7a2.5 2.5 0 0 1 4-3z"/>'),
  gear: svg('<path stroke="none" d="M21 5h6l1 5 4 2 4-3 4 4-3 4 2 4 5 1v6l-5 1-2 4 3 4-4 4-4-3-4 2-1 5h-6l-1-5-4-2-4 3-4-4 3-4-2-4-5-1v-6l5-1 2-4-3-4 4-4 4 3 4-2z"/><circle cx="24" cy="24" r="7" fill="#2a3a24" stroke="none"/>'),
  mail: svg('<path stroke="none" d="M6 13h36v22H6z"/><path fill="none" stroke="#2a3a24" stroke-width="2.4" d="M7 14l17 13 17-13"/>'),
  dino: svg('<path stroke="none" d="M4 34c6-2 10-6 13-10 2-3 5-5 9-5 3-4 8-6 13-5l5 3-4 2-6 1c-1 3-3 6-6 8l1 9h-3l-2-7-5 1 1 7h-3l-2-8c-4 2-7 4-11 4z"/>'),
  person: svg('<circle cx="24" cy="10" r="5" stroke="none"/><path stroke="none" d="M17 18h14l3 13h-4l-2-6v17h-4V32h-1v10h-4V25l-2 6h-4z"/>'),
  map: svg('<path stroke="none" d="M6 11l11-4 14 4 11-4v30l-11 4-14-4-11 4z" opacity=".95"/><path fill="none" stroke="#2a3a24" stroke-width="2" d="M17 7v30M31 11v30"/>'),
  // status
  meat: svg('<path stroke="none" d="M30 8c6 0 11 5 11 11 0 9-9 15-16 15l-4 4a4 4 0 1 1-6-1 4 4 0 1 1-1-6l4-4c0-7 4-19 12-19z"/>'),
  drop: svg('<path stroke="none" d="M24 5c6 9 13 16 13 24a13 13 0 0 1-26 0c0-8 7-15 13-24z"/>'),
  zz: svg('<path fill="none" stroke-width="4" d="M10 12h12L10 26h12M26 24h12L26 38h12"/>'),
  smile: svg('<circle cx="24" cy="24" r="18" stroke="none"/><circle cx="18" cy="20" r="2.6" fill="#2a3a24" stroke="none"/><circle cx="30" cy="20" r="2.6" fill="#2a3a24" stroke="none"/><path fill="none" stroke="#2a3a24" stroke-width="3" d="M15 28c5 6 13 6 18 0"/>'),
  cross: svg('<path stroke="none" d="M18 6h12v12h12v12H30v12H18V30H6V18h12z"/>'),
  shield: svg('<path stroke="none" d="M24 5l16 6v11c0 11-7 18-16 22C15 40 8 33 8 22V11z"/>'),
  star: svg('<path stroke="none" d="M24 4l6 13 14 1-11 9 4 14-13-8-13 8 4-14L4 18l14-1z"/>'),
  stress: svg('<path stroke="none" d="M26 4L10 27h11l-3 17 18-25H25z"/>'),
  // build categories
  fence: svg('<path stroke="none" d="M8 10h5v28H8zM22 10h5v28h-5zM36 10h5v28h-5z"/><path fill="none" stroke-width="2" d="M10 17h29M10 23h29M10 29h29"/><path stroke="none" d="M5 36h38v4H5z"/>'),
  path: svg('<path stroke="none" d="M18 42l4-36h4l4 36z" opacity=".95"/><path fill="none" stroke="#2a3a24" stroke-width="1.5" d="M21 14h6M20 22h8M19 31h10"/>'),
  kiosk: svg('<path stroke="none" d="M8 20l4-10h24l4 10z"/><path stroke="none" d="M11 22h26v18H11z" opacity=".85"/><path stroke="none" fill="#2a3a24" d="M17 27h14v6H17z"/>'),
  binoculars: svg('<circle cx="15" cy="30" r="9" stroke="none"/><circle cx="33" cy="30" r="9" stroke="none"/><path stroke="none" d="M11 10h8v14h-8zM29 10h8v14h-8zM19 18h10v6H19z"/><circle cx="15" cy="30" r="4" fill="#2a3a24" stroke="none"/><circle cx="33" cy="30" r="4" fill="#2a3a24" stroke="none"/>'),
  dna: svg('<path fill="none" stroke-width="3" d="M14 5c0 10 20 14 20 24S14 33 14 43M34 5c0 10-20 14-20 24s20 4 20 14"/><path fill="none" stroke-width="2" d="M17 11h14M16 17h16M17 31h14M16 37h16"/>'),
  badge: svg('<path stroke="none" d="M24 4l5 6 8-1 1 8 6 5-5 6 1 8-8 1-4 7-4-7-8-1 1-8-5-6 6-5 1-8 8 1z"/><circle cx="24" cy="24" r="6" fill="#2a3a24" stroke="none"/>'),
  hay: svg('<path stroke="none" d="M7 16h34v20H7z"/><path fill="none" stroke="#2a3a24" stroke-width="1.5" d="M7 22h34M7 29h34M15 16v20M33 16v20"/>'),
  palm: svg('<path fill="none" stroke-width="3.5" d="M24 44c0-12 1-20 3-26"/><path stroke="none" d="M27 18c-6-7-15-7-21-2 7-1 13 1 21 2zM27 18c3-8 11-12 17-10-6 2-11 6-17 10zM27 18c-8 0-14 5-15 12 4-5 9-9 15-12zM27 18c8-1 14 3 16 10-5-5-10-8-16-10zM27 18c0-7 4-12 10-14-4 4-7 9-10 14z"/>'),
  bulldoze: svg('<path stroke="none" d="M8 22h20v10H8zM12 14h10v8H12z"/><circle cx="13" cy="35" r="4" stroke="none"/><circle cx="25" cy="35" r="4" stroke="none"/><path stroke="none" d="M30 18l10-4v22l-10-4z"/>'),
  select: svg('<path stroke="none" d="M12 6l24 18-11 2 6 13-5 2-6-13-8 7z"/>'),
  info: svg('<circle cx="24" cy="24" r="18" stroke="none"/><path stroke="none" fill="#2a3a24" d="M21 20h6v16h-6zM21 11h6v6h-6z"/>'),
  close: svg('<path fill="none" stroke-width="5" d="M12 12l24 24M36 12L12 36"/>'),
  heli: svg('<path stroke="none" d="M8 22c0-5 5-8 12-8h9c5 0 8 3 8 7s-3 7-8 7H17c-5 0-9-2-9-6z"/><path stroke="none" d="M35 19h9v4h-9z"/><path fill="none" stroke-width="2.5" d="M6 9h30M21 9v5M14 32h18M17 28v4M28 28v4"/>'),
  camera: svg('<path stroke="none" d="M6 15h9l3-5h12l3 5h9v24H6z"/><circle cx="24" cy="27" r="7" fill="#2a3a24" stroke="none"/><circle cx="24" cy="27" r="4" stroke="none"/>'),
  play: svg('<path stroke="none" d="M14 8l24 16-24 16z"/>'),
  pause: svg('<path stroke="none" d="M12 8h9v32h-9zM27 8h9v32h-9z"/>'),
  ff: svg('<path stroke="none" d="M6 10l18 14L6 38zM24 10l18 14-18 14z"/>'),
  egg: svg('<path stroke="none" d="M24 5c8 0 14 14 14 24a14 14 0 0 1-28 0C10 19 16 5 24 5z"/>'),
  research: svg('<path stroke="none" d="M18 5h12v4h-2v11l11 18c1 3-1 5-4 5H13c-3 0-5-2-4-5l11-18V9h-2z"/><path fill="#2a3a24" stroke="none" d="M14 34h20l2 4H12z"/>'),
};

// Fossil finds for the Fossil Market grid: claw, skull, leg bone, vertebrae, tooth, rib, plus amber and gems.
const fsvg = (body) => `<svg viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
const B = 'fill="#efe2bc" stroke="#4a3418" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"';
export const FOSSIL_ICONS = [
  fsvg(`<path ${B} d="M10 40c4-10 10-20 22-30 4-3 8-2 6 3-6 8-12 16-16 27z"/><path ${B} d="M16 38c3-6 6-10 10-14"/>`),
  fsvg(`<path ${B} d="M6 26c2-9 10-14 20-13 9 1 15 6 16 12l-5 2 1 6-6 1-2 4-6-2-3 4-4-3-6 1-1-5-5-2z"/><circle cx="30" cy="20" r="3" fill="#4a3418"/><path ${B} d="M14 30l2 4M20 31l1 4M26 31l0 4"/>`),
  fsvg(`<path ${B} d="M10 12a5 5 0 1 1 7-3l18 22a5 5 0 1 1 -3 7a5 5 0 1 1 -7 -3l-18-22a5 5 0 0 1 3-1z"/>`),
  fsvg(`<g ${B}><rect x="6" y="18" width="9" height="12" rx="3"/><rect x="19" y="17" width="9" height="14" rx="3"/><rect x="32" y="18" width="9" height="12" rx="3"/><path d="M10 18v-6M24 17v-8M37 18v-6"/></g>`),
  fsvg(`<path ${B} d="M18 6c8 0 14 4 14 10 0 8-4 14-8 26-2-10-10-18-10-26 0-6 1-10 4-10z"/><path ${B} d="M18 14c2 4 6 6 10 6"/>`),
  fsvg(`<path ${B} fill="none" d="M10 8c14 4 22 14 26 32M16 6c12 6 18 16 20 26M8 16c10 4 16 12 18 24"/>`),
];
export const AMBER_ICON = fsvg('<path d="M24 5l15 9 3 16-12 13H18L6 30l3-16z" fill="#f0a020" stroke="#7a3a08" stroke-width="2.2" stroke-linejoin="round"/><path d="M14 16l8-5 9 4" fill="none" stroke="#ffe0a0" stroke-width="2" stroke-linecap="round"/><path d="M22 24c3-2 6 0 5 3s-5 3-6 1" fill="none" stroke="#5a2a04" stroke-width="1.6"/>');
export const GEM_ICON = (c) => fsvg(`<path d="M12 10h24l8 10-20 22L4 20z" fill="${c}" stroke="#2a2a30" stroke-width="2" stroke-linejoin="round"/><path d="M4 20h40M18 10l-4 10 10 22 10-22-4-10" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="1.4"/>`);
