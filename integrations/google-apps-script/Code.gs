/**
 * iBuild -> Gmail pessoal (sem Meta, Resend ou domínio próprio).
 * Cole no editor https://script.google.com/ usando a conta SUPER_ADMIN.
 * O token privativo está somente no arquivo ZIP de instalação; NUNCA publicar este script como web app.
 */
const IBUILD_BRIDGE_URL = 'https://pkpihrxucorfbniltdtk.supabase.co/functions/v1/ibuild-gmail-bridge';
const IBUILD_TOKEN_INSTALACAO = '__TOKEN_PRIVADO_AQUI__';
const IBUILD_PROP_TOKEN = 'IBUILD_GMAIL_BRIDGE_TOKEN';

function ibuildChamar_(payload) {
  const token = PropertiesService.getScriptProperties().getProperty(IBUILD_PROP_TOKEN);
  if (!token || token.length < 48) throw new Error('IBUILD_TOKEN_NAO_CONFIGURADO');
  const response = UrlFetchApp.fetch(IBUILD_BRIDGE_URL, {
    method: 'post',
    headers: { 'x-ibuild-gmail-token': token },
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    followRedirects: false
  });
  const status = response.getResponseCode();
  let result = {};
  try { result = JSON.parse(response.getContentText()); } catch (ignored) {}
  if (status !== 200 || result.ok !== true) {
    throw new Error('IBUILD_BRIDGE_HTTP_' + status + '_' + String(result.error || 'INVALID_RESPONSE').slice(0, 70));
  }
  return result;
}

function ibuildVerificarConta_(response) {
  const effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
  const recipient = String(response.recipient || '').trim().toLowerCase();
  // Never forward client orders to a third party or a different Gmail account.
  if (!effective || !recipient || effective !== recipient) throw new Error('GMAIL_DIFERENTE_DO_SUPER_ADMIN');
  return recipient;
}

/**
 * Executar manualmente UMA vez, e aceitar as permissões solicitadas pelo Google.
 * Reexecutar não duplica os acionadores.
 */
function instalar() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('SCRIPT_OCUPADO');
  try {
    if (IBUILD_TOKEN_INSTALACAO && IBUILD_TOKEN_INSTALACAO.length >= 48) {
      PropertiesService.getScriptProperties().setProperty(IBUILD_PROP_TOKEN, IBUILD_TOKEN_INSTALACAO);
    }
    const status = ibuildChamar_({ action: 'status' });
    ibuildVerificarConta_(status);
    if (MailApp.getRemainingDailyQuota() < 1) throw new Error('COTA_GMAIL_ESGOTADA');
    const triggers = ScriptApp.getProjectTriggers()
      .filter(x => x.getHandlerFunction() === 'processarPedidos');
    if (triggers.length === 0) {
      ScriptApp.newTrigger('processarPedidos').timeBased().everyMinutes(5).create();
    }
    // No order is sent during installation. A new order is needed to test delivery.
    console.log('IBUILD_GMAIL_INSTALADO. Acionador de 5 minutos configurado.');
    console.log('Pendentes no servidor: ' + Number(status.pending || 0));
    return true;
  } finally { lock.releaseLock(); }
}

function ibuildReportar_(claim, state, phase, code) {
  // Status after MailApp.sendEmail is ACCEPTED, not proof of inbox delivery.
  try {
    const result = ibuildChamar_({
      action: 'report', group_id: claim.group_id, claim_id: claim.claim_id,
      status: state, phase: phase || '', error_code: String(code || 'NONE').slice(0, 100)
    });
    console.log('IBUILD_GMAIL_REPORTADO_' + result.state);
  } catch (e) {
    console.error('IBUILD_GMAIL_ACK_INCERTO: nao repetir mensagem. ' + String(e).slice(0, 130));
  }
}

/** Acionador periódico. Um grupo -> um e-mail com PDFs individuais por loja. */
function processarPedidos() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return;
  try {
    const status = ibuildChamar_({ action: 'status' });
    const recipient = ibuildVerificarConta_(status);
    if (MailApp.getRemainingDailyQuota() < 1) {
      console.log('IBUILD_GMAIL_COTA_ESGOTADA. Aguardando proxima cota.');
      return;
    }
    const claim = ibuildChamar_({ action: 'claim' });
    if (claim.status !== 'CLAIMED') {
      console.log('IBUILD_GMAIL_' + claim.status);
      return;
    }
    let attachments = [];
    let attempted = false;
    try {
      if (!Array.isArray(claim.attachments) || claim.attachments.length < 1 || claim.attachments.length > 12) {
        throw new Error('ATTACHMENTS_INVALID');
      }
      if (String(claim.recipient).toLowerCase() !== recipient) throw new Error('RECIPIENT_CHANGED');
      let size = 0;
      for (const d of claim.attachments) {
        if (!/^https:\/\/pkpihrxucorfbniltdtk\.supabase\.co\//.test(d.url)) {
          throw new Error('PDF_URL_HOST_INVALID');
        }
        const response = UrlFetchApp.fetch(d.url, {
          method: 'get', muteHttpExceptions: true, followRedirects: false
        });
        if (response.getResponseCode() !== 200) throw new Error('PDF_DOWNLOAD_NOT_200');
        const bytes = response.getContent();
        size += bytes.length;
        if (size > 15000000 || bytes.length !== Number(d.size_bytes)) throw new Error('PDF_BYTES_INVALID');
        if (bytes.length < 100 || (bytes[0] & 255) !== 37 || (bytes[1] & 255) !== 80 ||
            (bytes[2] & 255) !== 68 || (bytes[3] & 255) !== 70) throw new Error('PDF_HEADER_INVALID');
        const calculated = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
          .map(x => (x & 255).toString(16).padStart(2, '0')).join('');
        if (calculated !== d.sha256) throw new Error('PDF_SHA256_MISMATCH');
        attachments.push(Utilities.newBlob(bytes, 'application/pdf', d.file_name));
      }
      attempted = true;
      MailApp.sendEmail({
        to: recipient,
        subject: String(claim.subject).slice(0, 150),
        body: String(claim.text).slice(0, 12000),
        name: 'iBuild Materiais — Pedidos',
        attachments
      });
      ibuildReportar_(claim, 'ACCEPTED', '', 'MAILAPP_RETURNED');
      console.log('IBUILD_GMAIL_ACEITO_PELO_GOOGLE: ' + String(claim.group_id).slice(0, 8));
    } catch (error) {
      // After attempting MailApp, delivery may have occurred even when an error is thrown.
      const code = String(error && error.message || 'ERROR')
        .replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70);
      ibuildReportar_(claim, attempted ? 'UNKNOWN' : 'FAILED',
        attempted ? 'AFTER_SEND_ATTEMPT' : 'BEFORE_SEND', code);
    }
  } finally { lock.releaseLock(); }
}

/** Conexão e cota. Não cria pedidos nem envia e-mails. */
function verificarConexao() {
  const result = ibuildChamar_({ action: 'status' });
  ibuildVerificarConta_(result);
  console.log('GMAIL_OK, PENDENTES=' + result.pending +
    ', COTA_RESTANTE=' + MailApp.getRemainingDailyQuota());
}

/** Desativa o acionador (não exclui e-mails nem pedidos). */
function pausar() {
  ScriptApp.getProjectTriggers()
    .filter(x => x.getHandlerFunction() === 'processarPedidos')
    .forEach(x => ScriptApp.deleteTrigger(x));
  console.log('IBUILD_GMAIL_PAUSADO');
}
