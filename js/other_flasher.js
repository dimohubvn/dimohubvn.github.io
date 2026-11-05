import { ESPLoader, Transport } from './esptool.js';

// Danh mục mặc định nếu không fetch được firmwares.json
const DEFAULT_FIRMWARES = [
  {
    id: "ai_voice_s3",
    name: "AI Voice - Esp32s3",
    subtitle: "Trợ lý giọng nói thông minh AI",
    icon: "🎙️",
    chip: "ESP32-S3",
    badge: "MỚI NHẤT",
    desc: "Trợ lý giọng nói thông minh AI tích hợp Google Gemini Live WebSocket hai chiều, Micro I2S, Loa khuếch đại MAX98357A, nhận diện từ khóa giọng nói tiếng Việt.",
    auto_flash_info: "Hệ thống tự động nạp toàn bộ: Bootloader + Partition Table + App AI Voice + Wake Word Model ESP-SR.",
    dir: "firmwares/ai_voice_s3",
    manifest: "firmwares/ai_voice_s3/manifest.json"
  }
];

const FALLBACK_MANIFEST = {
  name: "AI Voice - Esp32s3",
  chip: "ESP32-S3",
  partitions: [
    { name: "Bootloader", address: 0, file: "bootloader.bin" },
    { name: "Partition Table", address: 32768, file: "partition-table.bin" },
    { name: "App Firmware", address: 131072, file: "ai_voice_esp32s3.bin" },
    { name: "Wake Word Models", address: 6422528, file: "srmodels.bin" }
  ]
};

let firmwaresList = [];
let currentProject = null;

// DOM Elements
let tabsContainer, descText, autoInfoText;
let btnStartFlash, btnEraseFlash, btnClearConsole;
let terminalOutput, terminalStatusDot, terminalStatusText;
let progressContainer, progressStatus, progressPercentage, progressFill;

function log(msg, type = 'info') {
  if (!terminalOutput) return;
  const span = document.createElement('span');
  span.className = `log-${type}`;
  span.textContent = msg + '\n';
  terminalOutput.appendChild(span);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

const customTerminal = {
  clean() {
    if (terminalOutput) terminalOutput.textContent = '';
  },
  writeLine(data) {
    log(data, 'info');
  },
  write(data) {
    if (!terminalOutput) return;
    const span = document.createElement('span');
    span.className = 'log-info';
    span.textContent = data;
    terminalOutput.appendChild(span);
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
  }
};

async function initOtherFlasher() {
  tabsContainer = document.getElementById('extFwTabs');
  if (!tabsContainer) return;

  descText = document.getElementById('extFwDescText');
  autoInfoText = document.getElementById('extFwAutoInfo');

  btnStartFlash = document.getElementById('btnExtStartFlash');
  btnEraseFlash = document.getElementById('btnExtEraseFlash');
  btnClearConsole = document.getElementById('btnExtClearConsole');

  terminalOutput = document.getElementById('extTerminalOutput');
  terminalStatusDot = document.getElementById('extTerminalStatusDot');
  terminalStatusText = document.getElementById('extTerminalStatusText');

  progressContainer = document.getElementById('extProgressContainer');
  progressStatus = document.getElementById('extProgressStatus');
  progressPercentage = document.getElementById('extProgressPercentage');
  progressFill = document.getElementById('extProgressFill');

  btnStartFlash?.addEventListener('click', startFlash);
  btnEraseFlash?.addEventListener('click', eraseFlashOnly);
  btnClearConsole?.addEventListener('click', () => {
    terminalOutput.textContent = '';
    log('[Console] Đã xóa log.', 'info');
  });

  await loadCatalog();
}

async function loadCatalog() {
  try {
    const res = await fetch('firmwares.json');
    if (res.ok) {
      firmwaresList = await res.json();
    } else {
      firmwaresList = DEFAULT_FIRMWARES;
    }
  } catch (e) {
    firmwaresList = DEFAULT_FIRMWARES;
  }

  renderTabs();
  if (firmwaresList.length > 0) {
    selectProject(firmwaresList[0]);
  }
}

function renderTabs() {
  tabsContainer.innerHTML = '';
  firmwaresList.forEach((fw, idx) => {
    const tab = document.createElement('div');
    tab.className = `board-tab-btn ${idx === 0 ? 'active' : ''}`;
    tab.dataset.id = fw.id;
    tab.innerHTML = `
      <span style="font-size: 1.25rem;">${fw.icon || '🎙️'}</span>
      <div>
        <div style="font-weight: 700; color: #fff;">${fw.name}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">${fw.subtitle || fw.chip}</div>
      </div>
      ${fw.badge ? `<span class="badge-chip">${fw.badge}</span>` : ''}
    `;

    tab.addEventListener('click', () => {
      document.querySelectorAll('#extFwTabs .board-tab-btn').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selectProject(fw);
    });

    tabsContainer.appendChild(tab);
  });
}

function selectProject(fw) {
  currentProject = fw;
  if (descText) descText.textContent = fw.desc || '';
  if (autoInfoText) autoInfoText.innerHTML = `⚡ <strong>Tự động nạp:</strong> ${fw.auto_flash_info || 'Đầy đủ Bootloader, Partition Table và App Firmware.'}`;
  log(`\n[Chọn Loại] Đã chọn: ${fw.name}`, 'info');
}

// ⚡ Bắt đầu nạp firmware (1-Click)
async function startFlash() {
  if (!('serial' in navigator)) {
    alert('Trình duyệt của bạn hiện chưa hỗ trợ Web Serial API!\n\nVui lòng mở trang web này bằng Google Chrome hoặc Microsoft Edge trên máy tính để thực hiện nạp firmware trực tiếp.');
    log('LỖI: Trình duyệt không hỗ trợ Web Serial API. Hãy dùng Google Chrome hoặc Microsoft Edge!', 'error');
    return;
  }

  btnStartFlash.disabled = true;
  if (btnEraseFlash) btnEraseFlash.disabled = true;

  terminalStatusDot.style.background = '#f59e0b';
  terminalStatusDot.style.boxShadow = '0 0 8px #f59e0b';
  terminalStatusText.textContent = 'Đang yêu cầu kết nối cổng Serial...';
  progressContainer.style.display = 'block';
  progressFill.style.width = '0%';
  progressPercentage.textContent = '0%';
  progressStatus.textContent = 'Đang mở cổng COM...';

  let port = null;
  let transport = null;
  let esploader = null;

  try {
    log(`\n--- BẮT ĐẦU QUÁ TRÌNH NẠP FIRMWARE: ${currentProject.name} ---`, 'warn');
    log('1. Đang mở hộp thoại chọn cổng Serial COM...', 'info');

    port = await navigator.serial.requestPort();
    transport = new Transport(port, true);

    log('2. Khởi tạo kết nối với tốc độ baud 460800...', 'info');
    esploader = new ESPLoader({
      transport: transport,
      baudrate: 460800,
      romBaudrate: 115200,
      terminal: customTerminal
    });

    terminalStatusText.textContent = 'Đang đồng bộ chip ESP32-S3...';
    log('3. Đang đồng bộ và nhận diện vi xử lý...', 'info');
    const chip = await esploader.main();
    log(`-> Nhận diện chip thành công: ${chip}`, 'success');

    const mac = await esploader.chip.readMac(esploader);
    log(`-> Địa chỉ MAC thiết bị: ${mac}`, 'info');

    // Tự động xóa sạch toàn bộ Flash trước khi nạp để đảm bảo ổn định 100%
    terminalStatusText.textContent = 'Đang tự động xóa sạch Flash (Erase)...';
    progressStatus.textContent = 'Đang xóa sạch bộ nhớ Flash cũ (khoảng 10-20 giây)...';
    progressPercentage.textContent = 'Erase...';
    progressFill.style.width = '15%';
    log('\n⚡ [Tự Động Erase Flash] Đang xóa sạch toàn bộ bộ nhớ Flash để nạp firmware mới ổn định nhất...', 'warn');
    await esploader.eraseFlash();
    log('-> Đã xóa sạch Flash thành công!', 'success');

    // Tải cấu hình phân vùng
    let manifest = null;
    try {
      const manifestUrl = currentProject.manifest || `${currentProject.dir}/manifest.json`;
      const mfRes = await fetch(manifestUrl);
      if (mfRes.ok) {
        manifest = await mfRes.json();
      }
    } catch (e) {}

    if (!manifest || !manifest.partitions) {
      manifest = FALLBACK_MANIFEST;
    }

    terminalStatusText.textContent = 'Đang tải các phân vùng firmware...';
    progressStatus.textContent = 'Đang tải dữ liệu từ máy chủ...';
    log('\n4. Đang chuẩn bị các phân vùng nhị phân...', 'info');

    const baseDir = currentProject.dir || 'firmwares/ai_voice_s3';
    const fileArray = [];
    let totalBytes = 0;

    for (const part of manifest.partitions) {
      terminalStatusText.textContent = `Đang tải ${part.name}...`;
      const filePath = `${baseDir}/${part.file}`;
      const res = await fetch(filePath);
      if (!res.ok) {
        throw new Error(`Không thể tải ${filePath} (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      totalBytes += blob.size;

      const binaryString = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsBinaryString(blob);
      });

      const addr = typeof part.address === 'string' ? parseInt(part.address, 16) : part.address;
      fileArray.push({
        data: binaryString,
        address: addr
      });

      log(`  • [0x${addr.toString(16).toUpperCase()}] ${part.name}: ${(blob.size / 1024).toFixed(1)} KB`, 'info');
    }

    log(`-> Tổng dung lượng cần nạp: ${(totalBytes / 1024).toFixed(1)} KB qua ${fileArray.length} phân vùng.`, 'info');

    // Ghi flash với cấu hình nén và ghi đè an toàn nhất
    terminalStatusText.textContent = 'Đang ghi dữ liệu vào Flash...';
    progressStatus.textContent = 'Đang ghi flash...';
    log('\n5. Đang nạp toàn bộ các phân vùng vào Flash...', 'warn');

    const fileOffsets = [0];
    for (let idx = 0; idx < fileArray.length - 1; idx++) {
      fileOffsets.push(fileOffsets[idx] + fileArray[idx].data.length);
    }

    await esploader.writeFlash({
      fileArray: fileArray,
      flashSize: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex, written, total) => {
        const currentTotal = (fileOffsets[fileIndex] || 0) + written;
        const pct = Math.min(100, Math.round((currentTotal / totalBytes) * 100));
        progressFill.style.width = pct + '%';
        progressPercentage.textContent = pct + '%';
        progressStatus.textContent = `Đang ghi phân vùng [${fileIndex + 1}/${fileArray.length}]: ${pct}% (${(currentTotal / 1024).toFixed(0)} / ${(totalBytes / 1024).toFixed(0)} KB)`;
      }
    });

    progressFill.style.width = '100%';
    progressPercentage.textContent = '100%';
    progressStatus.textContent = 'Nạp hoàn tất 100%!';
    terminalStatusDot.style.background = '#10b981';
    terminalStatusDot.style.boxShadow = '0 0 8px #10b981';
    terminalStatusText.textContent = 'Nạp thành công!';

    log(`\n🎉 CHÚC MỪNG: NẠP THÀNH CÔNG 100% CHO ${currentProject.name}!`, 'success');
    log('Đang khởi động lại bo mạch ESP32-S3...', 'success');

    // Reset ESP32
    try {
      await esploader.hardReset();
    } catch (e) {}

  } catch (err) {
    log(`\n❌ LỖI TRONG QUÁ TRÌNH NẠP: ${err.message || err}`, 'error');
    terminalStatusDot.style.background = '#ef4444';
    terminalStatusDot.style.boxShadow = '0 0 8px #ef4444';
    terminalStatusText.textContent = 'Có lỗi xảy ra!';
    progressStatus.textContent = 'Lỗi nạp firmware!';
  } finally {
    if (transport) {
      try {
        await transport.disconnect();
      } catch (e) {}
    }
    btnStartFlash.disabled = false;
    if (btnEraseFlash) btnEraseFlash.disabled = false;
  }
}

// 🗑️ Xóa sạch chip
async function eraseFlashOnly() {
  if (!('serial' in navigator)) {
    alert('Trình duyệt chưa hỗ trợ Web Serial API! Vui lòng dùng Chrome hoặc Edge.');
    return;
  }

  const confirmed = confirm('⚠️ CẢNH BÁO XÓA SẠCH FLASH (ERASE CHIP):\n\nBạn có chắc chắn muốn xóa toàn bộ bộ nhớ flash của ESP32 không?\nThao tác này sẽ xóa sạch firmware hiện tại, bảng phân vùng và toàn bộ dữ liệu cấu hình NVS.');
  if (!confirmed) return;

  btnStartFlash.disabled = true;
  if (btnEraseFlash) btnEraseFlash.disabled = true;

  terminalStatusDot.style.background = '#f59e0b';
  terminalStatusDot.style.boxShadow = '0 0 8px #f59e0b';
  terminalStatusText.textContent = 'Đang kết nối để xóa Flash...';
  progressContainer.style.display = 'block';
  progressFill.style.width = '0%';
  progressPercentage.textContent = '...';
  progressStatus.textContent = 'Đang kết nối để xóa Flash...';

  let port = null;
  let transport = null;
  let esploader = null;

  try {
    log('\n--- BẮT ĐẦU XÓA SẠCH TOÀN BỘ FLASH TRÊN ESP32 ---', 'warn');
    port = await navigator.serial.requestPort();
    transport = new Transport(port, true);

    esploader = new ESPLoader({
      transport: transport,
      baudrate: 460800,
      romBaudrate: 115200,
      terminal: customTerminal
    });

    log('Đang nhận diện vi xử lý...', 'info');
    const chip = await esploader.main();
    log(`-> Chip: ${chip}`, 'success');

    terminalStatusText.textContent = 'Đang xóa sạch chip (Erase Flash)...';
    progressStatus.textContent = 'Đang xóa toàn bộ bộ nhớ Flash...';
    log('Đang thực hiện xóa trắng Flash (khoảng 15-25 giây)...', 'warn');
    await esploader.eraseFlash();

    log('\n🎉 THÀNH CÔNG: ĐÃ XÓA TRẮNG TOÀN BỘ FLASH TRÊN ESP32!', 'success');
    log('Bây giờ bo mạch đã sạch dữ liệu cũ. Bạn có thể tiến hành nạp lại Firmware mới.', 'info');
    terminalStatusDot.style.background = '#10b981';
    terminalStatusDot.style.boxShadow = '0 0 8px #10b981';
    terminalStatusText.textContent = 'Xóa Flash thành công!';
    progressPercentage.textContent = '100%';
    progressFill.style.width = '100%';
    progressStatus.textContent = 'Đã xóa trắng Flash!';

    try {
      await esploader.hardReset();
    } catch (e) {}

  } catch (err) {
    log(`\n❌ LỖI TRONG QUÁ TRÌNH ERASE: ${err.message || err}`, 'error');
    terminalStatusDot.style.background = '#ef4444';
    terminalStatusDot.style.boxShadow = '0 0 8px #ef4444';
    terminalStatusText.textContent = 'Lỗi xóa chip!';
    progressStatus.textContent = 'Lỗi Erase!';
  } finally {
    if (transport) {
      try {
        await transport.disconnect();
      } catch (e) {}
    }
    btnStartFlash.disabled = false;
    if (btnEraseFlash) btnEraseFlash.disabled = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOtherFlasher);
} else {
  initOtherFlasher();
}

export { initOtherFlasher };
