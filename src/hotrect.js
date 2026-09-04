// Decide, pela posição do cursor, se a janela do notch deve receber o mouse ou deixá-lo passar.
// Fica fora do main.js só para poder ser testado: é a conta que evita o "mouse preso" — a janela
// tem 960x560 transparentes, mas só a pastilha (hot) é clicável.
// Devolve true (ignorar o mouse), false (receber) ou null (não mexer — zona de folga, evita ficar alternando).
const FOLGA = 14;
function decideIgnore(cursor, janela, hot, folga = FOLGA) {
  if (!cursor || !janela) return null;
  if (!hot || !(hot.w > 0) || !(hot.h > 0)) {                   // sem retângulo ainda: usa a janela toda
    const dentroJanela = cursor.x >= janela.x && cursor.x < janela.x + janela.width && cursor.y >= janela.y && cursor.y < janela.y + janela.height;
    return dentroJanela ? null : true;
  }
  const x = janela.x + hot.x, y = janela.y + hot.y;
  const dentro = cursor.x >= x && cursor.x < x + hot.w && cursor.y >= y && cursor.y < y + hot.h;
  if (dentro) return false;
  const perto = cursor.x >= x - folga && cursor.x < x + hot.w + folga && cursor.y >= y - folga && cursor.y < y + hot.h + folga;
  return perto ? null : true;
}
module.exports = { decideIgnore, FOLGA };
