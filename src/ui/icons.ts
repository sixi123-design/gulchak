/** 잉크 외곽선 스타일 아이콘 (이모지·기호 대신: 기기마다 모양이 달라지지 않게) */
const svg = (body: string) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  gear: svg(
    '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.3"/>',
  ),
  sound: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  expand: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  pin: svg('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/>'),
  camera: svg('<path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z"/><circle cx="12" cy="13.2" r="3.2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  /** 레버 이름표 */
  tag: svg('<path d="M3.5 4.5h8.2l8.8 8.8-7.2 7.2-8.8-8.8z"/><circle cx="8.2" cy="9" r="1.7" fill="currentColor"/>'),
  // 배우기 스테이지 (이모지 대신: 기기마다 모양이 같게)
  stLevers: svg('<rect x="5" y="15" width="14" height="5" rx="1.5" fill="currentColor"/><path d="M12 15V7"/><circle cx="12" cy="5.5" r="2.6" fill="currentColor"/>'),
  stScoop: svg('<path d="M4 6h13l3 4-5 9H7z"/><path d="M7 19l-1 2M11 19v2M15 19l1 2"/>'),
  stCarry: svg('<path d="M5 18V11a6 6 0 0 1 12 0v2"/><path d="M13.5 10.5L17 14l3.5-3.5"/>'),
  stDump: svg('<path d="M2.5 20l6.5-9 4 5 2.5-3 6 7z" fill="currentColor"/><path d="M14 4l3 3M18 3v3"/>'),
  stFlat: svg('<path d="M3 19h18"/><path d="M5 15h14"/><path d="M15 4l-3 11"/><path d="M8 15l1.5-3h5"/>'),
  retry: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4 4.5v4.5h4.5"/>'),
};
