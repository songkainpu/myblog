(() => {
  const WIDTH = 1080;
  const HEIGHT = 1440;
  const QR_SIZE = 250;
  const QR_ENDPOINT = 'https://api.qrserver.com/v1/create-qr-code/';

  const loadImage = (source) => new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('二维码加载失败'));
    image.src = source;
  });

  const roundedRect = (ctx, x, y, width, height, radius) => {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  };

  const splitText = (text) => {
    if (window.Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text), ({ segment }) => segment);
    }
    return Array.from(text);
  };

  const wrapText = (ctx, text, maxWidth, maxLines) => {
    const segments = splitText(text.trim());
    const lines = [];
    let line = '';

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const candidate = line + segment;
      if (line && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line.trimEnd());
        line = segment.trimStart();
        if (lines.length === maxLines) {
          let last = lines[maxLines - 1];
          while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
          lines[maxLines - 1] = `${last.trimEnd()}…`;
          return lines;
        }
      } else {
        line = candidate;
      }
    }

    if (line && lines.length < maxLines) lines.push(line.trim());
    return lines;
  };

  const drawLines = (ctx, lines, x, y, lineHeight) => {
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  };

  const drawPoster = async (data) => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d');

    const background = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    background.addColorStop(0, '#f7f1e6');
    background.addColorStop(0.62, '#f2eadc');
    background.addColorStop(1, '#e8dfcf');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#0f766e';
    for (let y = 80; y < HEIGHT; y += 48) {
      for (let x = 80; x < WIDTH; x += 48) {
        if ((x + y) % 96 === 0) ctx.fillRect(x, y, 2, 2);
      }
    }
    ctx.restore();

    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, 18, HEIGHT);
    ctx.fillStyle = '#b45309';
    ctx.fillRect(18, 0, 5, HEIGHT);

    ctx.fillStyle = '#0f766e';
    ctx.font = '700 25px Georgia, "Times New Roman", serif';
    ctx.letterSpacing = '3px';
    ctx.fillText(data.site.toUpperCase(), 82, 102);
    ctx.letterSpacing = '0px';

    ctx.fillStyle = '#5f6b68';
    ctx.font = '500 22px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(data.date, 998, 100);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#c6b89f';
    ctx.fillRect(82, 145, 916, 2);

    ctx.fillStyle = '#172c2a';
    ctx.font = '700 64px "Noto Serif SC", "Source Han Serif SC", "STSong", serif';
    let titleLines = wrapText(ctx, data.title, 890, 4);
    if (titleLines.length > 3) {
      ctx.font = '700 56px "Noto Serif SC", "Source Han Serif SC", "STSong", serif';
      titleLines = wrapText(ctx, data.title, 900, 4);
    }
    drawLines(ctx, titleLines, 82, 245, 86);

    const titleBottom = 245 + (titleLines.length - 1) * 86;
    const accentY = titleBottom + 62;
    ctx.fillStyle = '#b45309';
    ctx.fillRect(82, accentY, 74, 7);

    ctx.fillStyle = '#52625f';
    ctx.font = '400 31px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
    const summaryLines = wrapText(ctx, data.summary, 875, 5);
    drawLines(ctx, summaryLines, 82, accentY + 76, 54);

    const footerY = 1070;
    ctx.fillStyle = '#d8ccba';
    ctx.fillRect(82, footerY, 916, 2);

    ctx.fillStyle = '#172c2a';
    ctx.font = '700 35px "Noto Serif SC", "Source Han Serif SC", "STSong", serif';
    ctx.fillText('把值得读的，分享给值得的人', 82, footerY + 76);

    ctx.fillStyle = '#5f6b68';
    ctx.font = '400 25px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
    ctx.fillText('保存到相册，再发送给微信 / QQ 好友', 82, footerY + 122);

    ctx.fillStyle = '#0f766e';
    ctx.font = '700 22px "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
    ctx.fillText('扫码阅读全文  →', 82, footerY + 210);

    const qrX = WIDTH - QR_SIZE - 82;
    const qrY = HEIGHT - QR_SIZE - 70;
    roundedRect(ctx, qrX - 18, qrY - 18, QR_SIZE + 36, QR_SIZE + 36, 22);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#c6b89f';
    ctx.lineWidth = 2;
    ctx.stroke();

    const qrUrl = `${QR_ENDPOINT}?size=500x500&margin=12&format=png&data=${encodeURIComponent(data.url)}`;
    const qrImage = await loadImage(qrUrl);
    ctx.drawImage(qrImage, qrX, qrY, QR_SIZE, QR_SIZE);

    ctx.save();
    ctx.translate(55, HEIGHT - 80);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = '#5f6b68';
    ctx.font = '600 18px Georgia, "Times New Roman", serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('READ · THINK · BUILD', 0, 0);
    ctx.restore();

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('浏览器无法导出分享图片'));
      }, 'image/png');
    });
  };

  const copyUrl = async (button) => {
    const original = button.textContent;
    try {
      await navigator.clipboard.writeText(button.dataset.shareCopy);
      button.textContent = '链接已复制';
    } catch (_) {
      window.prompt('复制文章链接', button.dataset.shareCopy);
      button.textContent = '请手动复制';
    }
    window.setTimeout(() => { button.textContent = original; }, 1600);
  };

  document.querySelectorAll('[data-share-copy]').forEach((button) => {
    button.addEventListener('click', () => copyUrl(button));
  });

  document.querySelectorAll('[data-share-poster-trigger]').forEach((trigger) => {
    const dialog = document.getElementById(trigger.dataset.sharePosterTrigger);
    if (!dialog) return;

    const closeButton = dialog.querySelector('[data-share-close]');
    const loading = dialog.querySelector('[data-share-loading]');
    const preview = dialog.querySelector('[data-share-image]');
    const download = dialog.querySelector('[data-share-download]');
    let posterUrl = '';
    let generating = false;

    const generate = async () => {
      if (posterUrl || generating) return;
      generating = true;
      try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        const blob = await drawPoster({
          url: dialog.dataset.shareUrl,
          title: dialog.dataset.shareTitle,
          summary: dialog.dataset.shareSummary,
          date: dialog.dataset.shareDate,
          site: dialog.dataset.shareSite
        });
        posterUrl = URL.createObjectURL(blob);
        preview.src = posterUrl;
        preview.hidden = false;
        download.href = posterUrl;
        download.download = dialog.dataset.shareFile;
        download.hidden = false;
        loading.hidden = true;
      } catch (error) {
        loading.innerHTML = '<strong>图片生成失败</strong><span>请检查网络后重试，或复制文章链接。</span>';
        loading.dataset.failed = 'true';
      } finally {
        generating = false;
      }
    };

    trigger.addEventListener('click', () => {
      dialog.showModal();
      generate();
    });

    closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });

    window.addEventListener('beforeunload', () => {
      if (posterUrl) URL.revokeObjectURL(posterUrl);
    });
  });
})();
