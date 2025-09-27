/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './js/**/*.{js,ts}',          // main.js + componentes
    './src/**/*.{html,js,ts}',    // por si metés plantillas ahí
  ],
  safelist: [
    // Estados que alternamos vía JS (asegura que existan en el build)
    'bg-green-500', 'bg-gray-300', 'bg-red-400',
    'ring-2', 'ring-blue-400',
    'opacity-0', 'opacity-100',
    '-translate-x-full', 'md:translate-x-0',
    'pointer-events-none',
  ],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      // Si querés tipografía global, descomentá:
      // fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [
    // Si instalás el plugin de forms: npm i -D @tailwindcss/forms
    // require('@tailwindcss/forms'),
  ],
};
