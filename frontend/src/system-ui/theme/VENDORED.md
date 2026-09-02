# Tema vendido a mano — design system de logística

Copia **literal** de `packages/logistics-ui/src/theme/` del repo
`mercadona/mo.staff-design`, el paquete `@mercadona/mo.library.logistics-ds`
0.42.1, commit `466bfd3aa5a6ca2e97dda468c15dc02e8584bef6`.

No se edita nada aquí: son ficheros generados (`READONLY` en cabecera). El
paquete real vive en el Verdaccio privado y CI de este repo no lo alcanza; el
día que el repo se mude a la organización, esta carpeta se borra y
`main.tsx` importa `@mercadona/mo.library.logistics-ds/theme/styles.css`.

## Refrescar

```bash
git clone --depth 1 git@github.com:mercadona/mo.staff-design.git /tmp/staff
rm -rf frontend/src/system-ui/theme/{styles.css,tokens,fonts,utility-classes}
cp -R /tmp/staff/packages/logistics-ui/src/theme/{styles.css,tokens,fonts,utility-classes} frontend/src/system-ui/theme/
rm -rf frontend/src/system-ui/theme/*/__tests__
```

Y actualizar el commit de arriba.
