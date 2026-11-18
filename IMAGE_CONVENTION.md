# Convenção de imagens

A busca/produção das fotografias foi intencionalmente deixada para uma fase posterior.

## Regra principal

Coloque as imagens em:

`public/images/products/<SKU>.webp`

Exemplos:

- `public/images/products/M001.webp`
- `public/images/products/M043.webp`
- `public/images/products/M140.webp`

O campo `image_key` nasce igual ao SKU. Se o administrador definir uma URL HTTPS externa no produto, ela tem prioridade.

Ordem de resolução:

1. `image_url` HTTPS;
2. `/images/products/<image_key>.webp`;
3. `/images/products/<SKU>.webp`;
4. placeholder neutro.

Imagem ausente nunca quebra o card nem o build.
