# STEELEYE

Aplicación web para análisis de planos estructurales, gestión de materiales y administración de proyectos de construcción. Desarrollada en JavaScript puro y TailwindCSS, sin frameworks ni backend.

---

## 🚀 Flujo de trabajo de la aplicación

### 1. Inicio

- Al abrir la app, se muestra un dashboard con acceso a todas las funciones principales.
- Navegación lateral para acceder a:
  - Gestión de proyectos
  - Analizador de planos (Blueprint Analyzer)
  - Desglose de materiales y mano de obra
  - Proveedores
  - Reportes

### 2. Analizador de Planos (Blueprint Analyzer)

- Subí un archivo PDF de planos estructurales.
- El sistema carga un catálogo oculto de piezas desde `assets/piezas.xlsx`.
- Analiza cada página del PDF:
  - Extrae texto y usa OCR (Tesseract.js) para máxima precisión.
  - Detecta piezas como columnas, vigas, ángulos y joists según el catálogo.
  - Marca cada pieza detectada en el plano con una etiqueta de color y código.
  - Muestra miniaturas navegables de cada página.
  - Presenta una tabla de totales por pieza.
  - Opción de análisis visual con OpenCV.js para detectar geometría estructural.

### 3. Gestión de Materiales y Mano de Obra

- Agregá materiales y mano de obra por proyecto.
- Calcula totales automáticamente.
- Exportá el desglose a CSV.

### 4. Proveedores

- Administrá proveedores asociados a cada proyecto.
- Guardá información de contacto, materiales y fechas.

### 5. Reportes

- Generá reportes en PDF o Excel con toda la información del proyecto.

---

## 🛠️ Instalación y uso

1. **Instalación de dependencias (solo para TailwindCSS):**
   ```sh
   npm install
   ```

2. **Compilar estilos:**
   ```sh
   npm run dev
   # o para producción
   npm run build
   ```

3. **Ejecutar la app:**
   - Abrí `index.html` en tu navegador. No requiere servidor.

---

## 📦 Estructura del proyecto

```
[`index.html`](index.html )
[`readme.md`](readme.md )
[`package.json`](package.json )
[`tailwind.config.js`](tailwind.config.js )
[`postcss.config.js`](postcss.config.js )
assets/
  piezas.xlsx
js/
  main.js
  components/
    blueprint-analyzer/
    ...
src/
  input.css
dist/
  output.css
```

---

## 📚 Tecnologías y librerías

- **TailwindCSS** (estilos)
- **PDF.js** (lectura y render de PDFs)
- **Tesseract.js** (OCR)
- **SheetJS** (lectura de Excel)
- **OpenCV.js** (detección visual, opcional)

Todas las librerías externas se cargan por CDN.

---

## 📝 Notas

- El catálogo de piezas (`assets/piezas.xlsx`) es invisible para el usuario.
- El sistema funciona 100% en frontend y puede ejecutarse offline (excepto por los CDNs).
- No requiere backend ni base de datos.

---

## 👨‍💻 Autor

Desarrollado por Nahuel para presentaciones y gestión de proyectos de construcción.

---
