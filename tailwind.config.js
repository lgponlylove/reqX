/** @type {import('tailwindcss').Config} */

/**
 * Các bước 200–500 của mấy màu accent đi qua CSS var để Light Mode đổi sang bản tối
 * hơn. Bản mặc định của Tailwind pha cho nền tối nên đặt trên nền trắng là không đọc
 * được (text-amber-300 chỉ 1.9:1). Fallback chính là bảng Tailwind gốc → Dark Mode
 * không đổi một điểm ảnh nào, khỏi phải khai báo gì thêm ở `:root`.
 *
 * Vùng 800/900/950 cũng phải đi qua var: Light Mode dùng mấy bước này làm NỀN chip
 * (`bg-emerald-950 text-emerald-300`), giữ nguyên màu tối thì chip thành nền tối + chữ
 * tối mới = vô hình. Đã kiểm `text-white` không đứng trên `bg-*-800/900/950` nào nên
 * đảo ngược được mà không làm mất chữ.
 */
const ACCENT_DEFAULTS = {
  amber: { 200: '253 230 138', 300: '252 211 77', 400: '251 191 36', 500: '245 158 11', 800: '146 64 14', 900: '120 53 15', 950: '69 26 3' },
  emerald: { 200: '167 243 208', 300: '110 231 183', 400: '52 211 153', 500: '16 185 129', 800: '6 95 70', 900: '6 78 59', 950: '2 44 34' },
  sky: { 200: '186 230 253', 300: '125 211 252', 400: '56 189 248', 500: '14 165 233', 800: '7 89 133', 900: '12 74 110', 950: '8 47 73' },
  cyan: { 200: '165 243 252', 300: '103 232 249', 400: '34 211 238', 500: '6 182 212', 800: '21 94 117', 900: '22 78 99', 950: '8 51 68' },
  rose: { 200: '254 205 211', 300: '253 164 175', 400: '251 113 133', 500: '244 63 94', 800: '159 18 57', 900: '136 19 55', 950: '76 5 25' },
  red: { 200: '254 202 202', 300: '252 165 165', 400: '248 113 113', 500: '239 68 68', 800: '153 27 27', 900: '127 29 29', 950: '69 10 10' },
  violet: { 200: '221 214 254', 300: '196 181 253', 400: '167 139 250', 500: '139 92 246', 800: '91 33 182', 900: '76 29 149', 950: '46 16 101' },
  purple: { 200: '233 213 255', 300: '216 180 254', 400: '192 132 252', 500: '168 85 247', 800: '107 33 168', 900: '88 28 135', 950: '59 7 100' },
  teal: { 200: '153 246 228', 300: '94 234 212', 400: '45 212 191', 500: '20 184 166', 800: '17 94 89', 900: '19 78 74', 950: '4 47 46' },
  orange: { 200: '254 215 170', 300: '253 186 116', 400: '251 146 60', 500: '249 115 22', 800: '154 52 18', 900: '124 45 18', 950: '67 20 7' },
};

const accentColors = Object.fromEntries(
  Object.entries(ACCENT_DEFAULTS).map(([name, steps]) => [
    name,
    Object.fromEntries(
      Object.entries(steps).map(([step, rgb]) => [
        step,
        `rgb(var(--accent-${name}-${step}, ${rgb}) / <alpha-value>)`,
      ]),
    ),
  ]),
);

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: 'rgb(var(--color-slate-50) / <alpha-value>)',
          100: 'rgb(var(--color-slate-100) / <alpha-value>)',
          200: 'rgb(var(--color-slate-200) / <alpha-value>)',
          300: 'rgb(var(--color-slate-300) / <alpha-value>)',
          400: 'rgb(var(--color-slate-400) / <alpha-value>)',
          500: 'rgb(var(--color-slate-500) / <alpha-value>)',
          600: 'rgb(var(--color-slate-600) / <alpha-value>)',
          700: 'rgb(var(--color-slate-700) / <alpha-value>)',
          750: 'rgb(var(--color-slate-750) / <alpha-value>)',
          800: 'rgb(var(--color-slate-800) / <alpha-value>)',
          850: 'rgb(var(--color-slate-850) / <alpha-value>)',
          900: 'rgb(var(--color-slate-900) / <alpha-value>)',
          950: 'rgb(var(--color-slate-950) / <alpha-value>)',
        },
        cyber: {
          emerald: '#10b981',
          cyan: '#06b6d4',
          glow: 'rgba(16, 185, 129, 0.15)',
        },
        ...accentColors,
      },
    },
  },
  plugins: [],
};

