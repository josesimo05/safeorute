export function firebaseErrorMessage(error, {guest = false, provider, moderation = false, fallback = 'No se pudo completar la operación. Inténtalo de nuevo.'} = {}) {
  switch (error?.code) {
    case 'auth/admin-restricted-operation':
    case 'auth/operation-not-allowed':
      if (provider === 'gmail') return 'El acceso con Gmail no está habilitado. Avisa al administrador.';
      return guest
        ? 'No está habilitado el envío como invitado. Inicia sesión o avisa al administrador.'
        : 'El acceso por correo no está habilitado en esta app. Avisa al administrador.';
    case 'auth/configuration-not-found':
      return 'Firebase Authentication no está configurado en este proyecto. Avisa al administrador para activarlo.';
    case 'firebase/configuration-incomplete':
    case 'firebase/initialization-failed':
      return 'La configuración de Firebase está incompleta. Avisa al administrador para conectar la base compartida.';
    case 'auth/popup-blocked':
      return 'El navegador bloqueó el acceso. Permite la ventana emergente y vuelve a pulsar Continuar con Gmail.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Se canceló el inicio de sesión. Puedes intentarlo otra vez.';
    case 'auth/account-exists-with-different-credential':
      return 'Ya existe una cuenta con ese correo. Usa el acceso con correo y contraseña.';
    case 'moderation/already-reviewed':
    case 'moderation/report-not-found':
      return 'Este reporte ya fue revisado. La lista se actualizará automáticamente.';
    case 'moderation/not-published':
    case 'moderation/already-withdrawn':
      return 'Este reporte ya no está publicado. La lista se actualizará automáticamente.';
    case 'moderation/not-authorized':
    case 'moderation/session-changed':
      return 'No tienes permiso para revisar reportes.';
    case 'auth/invalid-api-key':
      return 'La configuración de Firebase no es válida. Avisa al administrador para revisar la clave API.';
    case 'auth/unauthorized-domain':
      return 'Este dominio no está autorizado para iniciar sesión. Avisa al administrador para habilitarlo.';
    case 'auth/email-already-in-use':
      return 'Este correo ya tiene una cuenta. Inicia sesión o usa otro correo.';
    case 'auth/weak-password':
      return 'La contraseña es demasiado débil. Usa al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'Introduce un correo electrónico válido.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'El correo o la contraseña no son correctos. Revisa tus datos.';
    case 'auth/too-many-requests':
      return 'Hay demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
    case 'REPORTS_RATE_LIMIT':
      return 'Has alcanzado el límite temporal de reportes. Inténtalo más tarde.';
    case 'REPORTS_NOT_CONFIGURED':
      return 'No pudimos comprobar el envío con cédula. Reintenta antes de enviar.';
    case 'REPORTS_AUTH_REQUIRED':
    case 'REPORTS_UNAVAILABLE':
    case 'auth/network-request-failed':
    case 'unavailable':
    case 'firestore/unavailable':
      return 'No se pudo conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.';
    case 'permission-denied':
    case 'firestore/permission-denied':
      if (moderation) return 'No tienes permiso para revisar reportes.';
      return 'No tienes permiso para guardar el reporte. Inicia sesión o avisa al administrador.';
    default:
      // Backend messages can contain credentials or internal details.
      return fallback;
  }
}
