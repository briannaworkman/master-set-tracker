export interface Theme {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  missing: string;
  accent: string;
  overlay: string;
}

export const light: Theme = {
  bg: '#FBFAF7',
  surface: '#FFFFFF',
  border: '#ECE8E0',
  text: '#1D1B18',
  muted: '#7A756C',
  missing: '#C4BEB3',
  accent: '#1D1B18',
  overlay: 'rgba(29,27,24,0.35)',
};

export const dark: Theme = {
  bg: '#151412',
  surface: '#1F1D1A',
  border: '#2C2925',
  text: '#F3F0EA',
  muted: '#A19B90',
  missing: '#5A554D',
  accent: '#F3F0EA',
  overlay: 'rgba(0,0,0,0.55)',
};
