# Marca SafeRoute

La identidad usa azul marino `#16324F`, turquesa oscuro `#087F8C`, blanco suave `#F5F8FA` y ámbar `#F4B942`. El modo oscuro utiliza superficies marinas y variantes claras de texto; los errores y categorías del mapa mantienen diferencias semánticas.

`logo-source.png` adapta el símbolo aportado por el propietario: pin de ubicación, casa y ruta en S. La adaptación se preparó con la herramienta de imágenes para disponer de un exterior transparente. La cabecera combina el símbolo con el nombre SafeRoute en texto accesible.

Los PNG de `public/` y del dashboard ITS son exportaciones del mismo origen. Para regenerar tamaños y márgenes de instalación, con ImageMagick 7 instalado:

```bash
node scripts/export-branding.mjs
```

El build normal usa los archivos exportados y no necesita ImageMagick. La fuente de mayor tamaño permanece fuera de `public/` para no descargarla en la PWA. El icono `maskable` tiene margen adicional para proteger el símbolo al aplicar recortes del sistema.
