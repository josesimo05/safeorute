// Included offline support articles. This module is also read by the support
// API, so keep it independent of React, browser globals and runtime secrets.
const articleIds = Object.freeze(['install', 'gps', 'routes', 'reports', 'account', 'map', 'its', 'privacy']);

const content = {
  es: [
    ['¿Cómo instalo SafeRoute y qué funciona sin conexión?', 'Usa la opción Instalar de un navegador compatible; en iPhone, abre Safari y busca Compartir → Añadir a pantalla de inicio. Después de la primera carga, la interfaz y los textos incluidos pueden funcionar sin conexión, pero mapas, búsquedas, rutas, Firebase e ITS necesitan Internet.'],
    ['¿Por qué no aparece mi posición o se detiene el GPS?', 'Abre SafeRoute mediante HTTPS y permite la ubicación en tu navegador y dispositivo. Mantén la app visible: el navegador puede suspender el GPS al bloquear la pantalla o cambiar de aplicación, y una precisión baja puede limitar las indicaciones. Configura la navegación con el vehículo detenido.'],
    ['¿Cómo busco un destino y sigo una ruta?', 'Escribe el origen y el destino, elige las sugerencias y selecciona una ruta antes de pulsar Iniciar navegación. SafeRoute sigue esa alternativa dentro de la app y permite solicitar un recálculo si te desvías. Los tiempos de Geoapify son estimados, no incluyen tráfico en tiempo real ni garantizan una ruta segura.'],
    ['¿Qué ocurre cuando envío un reporte?', 'Pulsa Reportar, elige la categoría y una ubicación aproximada; no incluyas nombres, teléfonos u otros datos personales. El reporte queda pendiente de revisión y solo los aprobados se muestran públicamente. La ausencia de reportes no demuestra que un lugar sea seguro.'],
    ['¿Cómo creo una cuenta o inicio sesión?', 'Usa Entrar / Crear cuenta con correo y contraseña. El proyecto Firebase debe tener configurados Authentication, el proveedor Correo/contraseña y los dominios autorizados; en una demostración sin Firebase no se pueden crear cuentas reales. Si falla, revisa el mensaje de la app y la conexión: este soporte no puede modificar tu cuenta.'],
    ['¿Qué hago si el mapa no carga o muestra otro país?', 'Comprueba Internet y usa Reintentar mapa cuando aparezca; mapas, búsqueda y rutas dependen de Geoapify y de la configuración del proyecto. En el botón del globo puedes cambiar el país para centrar el mapa y limitar las búsquedas; Todos los países permite buscar globalmente. El control de tema cambia entre claro y oscuro sin invertir las imágenes del mapa.'],
    ['¿Los datos de Tráfico ITS son reales?', 'El servicio vinculado actualmente muestra una demostración sintética: el escenario congestionado genera vehículos a 8 km/h frente a una referencia de 40 km/h. La regla espera 30 segundos de evidencia elegible antes de alertar y mantiene la causa no determinada; no confirma accidentes ni describe tránsito real. Ver cámara en el mapa centra una ubicación ilustrativa, sin cambiar tus rutas.'],
    ['¿Qué datos se comparten y sirve este soporte para emergencias?', 'Al consultar a la IA se envía tu pregunta para responder, sin adjuntar automáticamente tus reportes o el historial de conversación; no escribas datos privados. El GPS se usa durante la sesión sin guardar un historial de trayectos, y el ITS no guarda imágenes, video, rostros ni placas. Este soporte no atiende emergencias: utiliza los canales oficiales cuando corresponda.'],
  ],
  en: [
    ['How do I install SafeRoute, and what works offline?', 'Use Install in a supported browser; on iPhone, open Safari and look for Share → Add to Home Screen. After the first load, the interface and included text can work offline, but maps, search, routes, Firebase and ITS need Internet access.'],
    ['Why is my position missing, or why does GPS stop?', 'Open SafeRoute over HTTPS and allow location access in your browser and device settings. Keep the app visible: the browser may pause GPS when the screen locks or you switch apps, and poor accuracy can limit guidance. Set up navigation while the vehicle is stopped.'],
    ['How do I search for a destination and follow a route?', 'Enter the origin and destination, select suggestions and choose a route before pressing Start navigation. SafeRoute follows that alternative inside the app and lets you request a new calculation if you leave it. Geoapify times are estimates without real-time traffic and do not guarantee a safe route.'],
    ['What happens when I submit a report?', 'Press Report, choose a category and an approximate location, and omit names, phone numbers and other personal information. The report awaits review, and only approved reports are shown publicly. No reports does not mean a place is safe.'],
    ['How do I create an account or sign in?', 'Use Sign in / Create account with an email address and password. The Firebase project must have Authentication, the Email/password provider and authorized domains configured; a demonstration without Firebase cannot create real accounts. If it fails, check the app message and your connection: this support cannot change your account.'],
    ['What if the map does not load or shows another country?', 'Check Internet access and use Retry map when offered; maps, search and routes depend on Geoapify and the project configuration. Use the globe button to choose a country, center the map and restrict searches; All countries enables worldwide search. The theme control switches light and dark modes without inverting map images.'],
    ['Are the ITS traffic measurements real?', 'The currently linked service shows a synthetic demonstration: the congested scenario generates vehicles at 8 km/h against a 40 km/h reference. The rule waits for 30 seconds of eligible evidence before alerting and keeps the cause undetermined; it does not confirm accidents or describe real traffic. View camera on map centers an illustrative location without changing your routes.'],
    ['What data is shared, and can this support handle emergencies?', 'Asking the AI sends your question for an answer without automatically attaching reports or conversation history; do not enter private information. GPS is used during the session without saving a trip history, and ITS does not save images, video, faces or license plates. This support does not handle emergencies: use official channels when needed.'],
  ],
  fr: [
    ['Comment installer SafeRoute et que peut-on utiliser hors connexion ?', 'Utilisez Installer dans un navigateur compatible ; sur iPhone, ouvrez Safari puis Partager → Sur l’écran d’accueil. Après le premier chargement, l’interface et les textes inclus peuvent fonctionner hors connexion, mais les cartes, recherches, itinéraires, Firebase et ITS nécessitent Internet.'],
    ['Pourquoi ma position ne s’affiche-t-elle pas ou le GPS s’arrête-t-il ?', 'Ouvrez SafeRoute en HTTPS et autorisez la localisation dans le navigateur et les réglages de l’appareil. Gardez l’application visible : le navigateur peut suspendre le GPS lorsque l’écran se verrouille ou que vous changez d’application, et une précision faible peut limiter le guidage. Configurez la navigation à l’arrêt.'],
    ['Comment rechercher une destination et suivre un itinéraire ?', 'Saisissez le départ et la destination, choisissez les suggestions puis un itinéraire avant d’appuyer sur Démarrer la navigation. SafeRoute suit cette option dans l’application et permet de demander un nouveau calcul si vous vous en écartez. Les durées Geoapify sont estimées, sans trafic en temps réel, et ne garantissent pas un itinéraire sûr.'],
    ['Que se passe-t-il lorsque j’envoie un signalement ?', 'Appuyez sur Signaler, choisissez une catégorie et une position approximative, sans noms, numéros de téléphone ni autres données personnelles. Le signalement attend une vérification et seuls les signalements approuvés sont publics. L’absence de signalements ne signifie pas qu’un lieu est sûr.'],
    ['Comment créer un compte ou me connecter ?', 'Utilisez Connexion / Créer un compte avec une adresse e-mail et un mot de passe. Le projet Firebase doit avoir Authentication, le fournisseur E-mail/mot de passe et les domaines autorisés configurés ; une démonstration sans Firebase ne crée pas de comptes réels. En cas d’échec, consultez le message de l’application et la connexion : cette aide ne peut pas modifier votre compte.'],
    ['Que faire si la carte ne charge pas ou affiche un autre pays ?', 'Vérifiez Internet et utilisez Réessayer la carte si proposé ; les cartes, recherches et itinéraires dépendent de Geoapify et de la configuration du projet. Le bouton globe permet de choisir un pays, centrer la carte et limiter les recherches ; Tous les pays permet une recherche mondiale. Le thème clair ou sombre ne modifie pas les couleurs des images cartographiques par inversion.'],
    ['Les mesures de trafic ITS sont-elles réelles ?', 'Le service lié présente actuellement une démonstration synthétique : le scénario congestionné génère des véhicules à 8 km/h avec une référence de 40 km/h. La règle attend 30 secondes d’éléments exploitables avant l’alerte et laisse la cause indéterminée ; elle ne confirme aucun accident et ne décrit pas le trafic réel. Voir la caméra sur la carte centre un emplacement illustratif sans modifier vos itinéraires.'],
    ['Quelles données sont partagées et cette aide traite-t-elle les urgences ?', 'Une demande à l’IA envoie votre question pour obtenir une réponse, sans joindre automatiquement vos signalements ou l’historique de conversation ; ne saisissez pas de données privées. Le GPS sert pendant la session sans enregistrer d’historique de trajets, et ITS ne conserve ni images, ni vidéo, ni visages, ni plaques. Cette aide ne traite pas les urgences : utilisez les services officiels si nécessaire.'],
  ],
  pt: [
    ['Como instalo o SafeRoute e o que funciona sem conexão?', 'Use Instalar em um navegador compatível; no iPhone, abra o Safari e procure Compartilhar → Adicionar à Tela de Início. Após o primeiro carregamento, a interface e os textos incluídos podem funcionar sem conexão, mas mapas, buscas, rotas, Firebase e ITS precisam de Internet.'],
    ['Por que minha posição não aparece ou o GPS para?', 'Abra o SafeRoute por HTTPS e permita a localização no navegador e nas configurações do dispositivo. Mantenha o aplicativo visível: o navegador pode suspender o GPS ao bloquear a tela ou trocar de aplicativo, e a baixa precisão pode limitar as instruções. Configure a navegação com o veículo parado.'],
    ['Como procuro um destino e sigo uma rota?', 'Digite a origem e o destino, selecione as sugestões e escolha uma rota antes de tocar em Iniciar navegação. O SafeRoute segue essa alternativa dentro do aplicativo e permite solicitar um novo cálculo caso você saia da rota. Os tempos do Geoapify são estimados, sem trânsito em tempo real, e não garantem uma rota segura.'],
    ['O que acontece quando envio um relato?', 'Toque em Relatar, escolha a categoria e uma localização aproximada, sem nomes, telefones ou outros dados pessoais. O relato fica pendente de revisão e apenas os aprovados são exibidos publicamente. A ausência de relatos não significa que um local seja seguro.'],
    ['Como crio uma conta ou entro?', 'Use Entrar / Criar conta com e-mail e senha. O projeto Firebase deve ter Authentication, o provedor E-mail/senha e os domínios autorizados configurados; uma demonstração sem Firebase não cria contas reais. Se falhar, confira a mensagem do aplicativo e a conexão: este suporte não pode alterar sua conta.'],
    ['O que faço se o mapa não carregar ou mostrar outro país?', 'Confira a Internet e use Tentar mapa novamente quando disponível; mapas, buscas e rotas dependem do Geoapify e da configuração do projeto. O botão do globo permite selecionar um país, centralizar o mapa e limitar as buscas; Todos os países permite busca mundial. O controle de tema alterna entre claro e escuro sem inverter as imagens do mapa.'],
    ['As medições de Tráfego ITS são reais?', 'O serviço vinculado mostra atualmente uma demonstração sintética: o cenário congestionado gera veículos a 8 km/h com referência de 40 km/h. A regra espera 30 segundos de evidência válida antes do alerta e mantém a causa indeterminada; não confirma acidentes nem descreve trânsito real. Ver câmera no mapa centraliza uma localização ilustrativa sem alterar suas rotas.'],
    ['Quais dados são compartilhados e este suporte atende emergências?', 'Ao consultar a IA, sua pergunta é enviada para obter uma resposta, sem anexar automaticamente relatos ou histórico de conversa; não escreva dados privados. O GPS é usado durante a sessão sem salvar um histórico de trajetos, e o ITS não salva imagens, vídeos, rostos ou placas. Este suporte não atende emergências: utilize os canais oficiais quando necessário.'],
  ],
  de: [
    ['Wie installiere ich SafeRoute, und was funktioniert offline?', 'Verwende Installieren in einem unterstützten Browser; auf dem iPhone öffnest du Safari und wählst Teilen → Zum Home-Bildschirm. Nach dem ersten Laden können die Oberfläche und enthaltenen Texte offline funktionieren, doch Karten, Suche, Routen, Firebase und ITS benötigen Internet.'],
    ['Warum fehlt mein Standort oder stoppt das GPS?', 'Öffne SafeRoute über HTTPS und erlaube den Standortzugriff im Browser und auf dem Gerät. Halte die App sichtbar: Beim Sperren des Bildschirms oder beim App-Wechsel kann der Browser GPS aussetzen, und geringe Genauigkeit kann die Hinweise einschränken. Richte die Navigation bei stehendem Fahrzeug ein.'],
    ['Wie suche ich ein Ziel und folge einer Route?', 'Gib Start und Ziel ein, wähle passende Vorschläge und eine Route und tippe dann auf Navigation starten. SafeRoute folgt dieser Alternative innerhalb der App und ermöglicht eine angeforderte Neuberechnung beim Abweichen. Geoapify-Zeiten sind Schätzungen ohne Echtzeitverkehr und garantieren keine sichere Route.'],
    ['Was passiert mit einer eingereichten Meldung?', 'Tippe auf Melden, wähle eine Kategorie und einen ungefähren Standort und lasse Namen, Telefonnummern und andere persönliche Angaben weg. Die Meldung wartet auf Prüfung; nur genehmigte Meldungen werden öffentlich angezeigt. Fehlende Meldungen bedeuten nicht, dass ein Ort sicher ist.'],
    ['Wie erstelle ich ein Konto oder melde mich an?', 'Verwende Anmelden / Konto erstellen mit E-Mail-Adresse und Passwort. Im Firebase-Projekt müssen Authentication, der Anbieter E-Mail/Passwort und die zugelassenen Domains eingerichtet sein; eine Demo ohne Firebase kann keine echten Konten erstellen. Prüfe bei Fehlern die Meldung in der App und die Verbindung: Diese Hilfe kann dein Konto nicht verändern.'],
    ['Was tun, wenn die Karte nicht lädt oder ein anderes Land zeigt?', 'Prüfe die Internetverbindung und verwende Karte erneut laden, falls angeboten; Karten, Suche und Routen hängen von Geoapify und der Projektkonfiguration ab. Mit dem Globus wählst du ein Land, zentrierst die Karte und begrenzt die Suche; Alle Länder ermöglicht weltweite Suche. Der Hell-/Dunkelmodus invertiert die Kartenbilder nicht.'],
    ['Sind die ITS-Verkehrsmessungen echt?', 'Der verknüpfte Dienst zeigt derzeit eine synthetische Demo: Im Stauszenario werden Fahrzeuge mit 8 km/h bei einer Referenz von 40 km/h erzeugt. Die Regel wartet vor einer Warnung auf 30 Sekunden geeigneter Beobachtungen und lässt die Ursache unbestimmt; sie bestätigt keine Unfälle und beschreibt keinen realen Verkehr. Kamera auf Karte anzeigen zentriert einen beispielhaften Ort, ohne deine Routen zu ändern.'],
    ['Welche Daten werden geteilt, und hilft dieser Support im Notfall?', 'Bei einer KI-Anfrage wird deine Frage für die Antwort gesendet, ohne automatisch Meldungen oder den Gesprächsverlauf anzuhängen; gib keine privaten Daten ein. GPS wird während der Sitzung ohne gespeicherten Fahrtverlauf verwendet, und ITS speichert keine Bilder, Videos, Gesichter oder Kennzeichen. Dieser Support ist kein Notfalldienst: Nutze bei Bedarf die offiziellen Stellen.'],
  ],
  it: [
    ['Come installo SafeRoute e cosa funziona senza connessione?', 'Usa Installa in un browser compatibile; su iPhone apri Safari e cerca Condividi → Aggiungi alla schermata Home. Dopo il primo caricamento, l’interfaccia e i testi inclusi possono funzionare offline, ma mappe, ricerca, percorsi, Firebase e ITS richiedono Internet.'],
    ['Perché non vedo la mia posizione o il GPS si ferma?', 'Apri SafeRoute tramite HTTPS e consenti la posizione nel browser e nelle impostazioni del dispositivo. Mantieni l’app visibile: il browser può sospendere il GPS quando blocchi lo schermo o cambi app, e una precisione scarsa può limitare le indicazioni. Imposta la navigazione con il veicolo fermo.'],
    ['Come cerco una destinazione e seguo un percorso?', 'Scrivi partenza e destinazione, seleziona i suggerimenti e scegli un percorso prima di premere Avvia navigazione. SafeRoute segue quell’alternativa dentro l’app e permette di richiedere un nuovo calcolo se esci dal percorso. I tempi Geoapify sono stime senza traffico in tempo reale e non garantiscono un percorso sicuro.'],
    ['Cosa succede quando invio una segnalazione?', 'Premi Segnala, scegli categoria e posizione approssimativa, senza nomi, numeri di telefono o altri dati personali. La segnalazione resta in attesa di verifica e solo quelle approvate sono pubbliche. L’assenza di segnalazioni non significa che un luogo sia sicuro.'],
    ['Come creo un account o accedo?', 'Usa Accedi / Crea account con email e password. Il progetto Firebase deve avere Authentication, il provider Email/password e i domini autorizzati configurati; una demo senza Firebase non può creare account reali. In caso di errore, controlla il messaggio dell’app e la connessione: questa assistenza non può modificare il tuo account.'],
    ['Cosa faccio se la mappa non si carica o mostra un altro paese?', 'Controlla Internet e usa Riprova mappa quando disponibile; mappe, ricerca e percorsi dipendono da Geoapify e dalla configurazione del progetto. Il pulsante del globo permette di scegliere un paese, centrare la mappa e limitare le ricerche; Tutti i paesi consente la ricerca globale. Il tema chiaro o scuro non inverte le immagini della mappa.'],
    ['Le misurazioni di Traffico ITS sono reali?', 'Il servizio collegato mostra attualmente una dimostrazione sintetica: lo scenario congestionato genera veicoli a 8 km/h rispetto a un riferimento di 40 km/h. La regola attende 30 secondi di osservazioni valide prima di avvisare e mantiene la causa indeterminata; non conferma incidenti né descrive traffico reale. Mostra telecamera sulla mappa centra una posizione illustrativa senza modificare i tuoi percorsi.'],
    ['Quali dati vengono condivisi e questa assistenza gestisce emergenze?', 'Quando consulti l’IA viene inviata la tua domanda per ricevere una risposta, senza allegare automaticamente segnalazioni o cronologia della conversazione; non scrivere dati privati. Il GPS viene usato durante la sessione senza salvare una cronologia dei viaggi, e ITS non salva immagini, video, volti o targhe. Questa assistenza non gestisce emergenze: usa i canali ufficiali quando necessario.'],
  ],
  ar: [
    ['كيف أثبّت SafeRoute وما الذي يعمل دون اتصال؟', 'استخدم خيار التثبيت في متصفح متوافق؛ وعلى iPhone افتح Safari ثم مشاركة ← إضافة إلى الشاشة الرئيسية. بعد التحميل الأول يمكن أن تعمل الواجهة والنصوص المضمّنة دون اتصال، لكن الخرائط والبحث والمسارات وFirebase وITS تحتاج إلى الإنترنت.'],
    ['لماذا لا يظهر موقعي أو يتوقف GPS؟', 'افتح SafeRoute عبر HTTPS واسمح بالوصول إلى الموقع في المتصفح وإعدادات الجهاز. أبقِ التطبيق ظاهرًا، فقد يعلّق المتصفح GPS عند قفل الشاشة أو الانتقال إلى تطبيق آخر، وقد تحدّ الدقة المنخفضة من الإرشادات. اضبط الملاحة عندما تكون المركبة متوقفة.'],
    ['كيف أبحث عن وجهة وأتبع مسارًا؟', 'اكتب نقطة الانطلاق والوجهة، واختر الاقتراحات ثم المسار قبل الضغط على بدء الملاحة. يتبع SafeRoute الخيار المحدد داخل التطبيق ويتيح طلب إعادة الحساب إذا ابتعدت عنه. أوقات Geoapify تقديرية ولا تتضمن حركة المرور الآنية ولا تضمن مسارًا آمنًا.'],
    ['ماذا يحدث عندما أرسل بلاغًا؟', 'اضغط على الإبلاغ واختر الفئة وموقعًا تقريبيًا، دون أسماء أو أرقام هواتف أو بيانات شخصية أخرى. ينتظر البلاغ المراجعة ولا تُعرض علنًا إلا البلاغات المعتمدة. غياب البلاغات لا يعني أن المكان آمن.'],
    ['كيف أنشئ حسابًا أو أسجّل الدخول؟', 'استخدم تسجيل الدخول / إنشاء حساب مع البريد الإلكتروني وكلمة المرور. يجب إعداد Authentication ومزوّد البريد الإلكتروني وكلمة المرور والنطاقات المسموح بها في مشروع Firebase؛ ولا يمكن للعرض التجريبي دون Firebase إنشاء حسابات حقيقية. إذا فشلت العملية فراجع رسالة التطبيق والاتصال، فهذه المساعدة لا تستطيع تعديل حسابك.'],
    ['ماذا أفعل إذا لم تُحمّل الخريطة أو أظهرت بلدًا آخر؟', 'تحقق من الإنترنت واستخدم إعادة محاولة الخريطة عند ظهورها؛ فالخرائط والبحث والمسارات تعتمد على Geoapify وإعدادات المشروع. يتيح زر الكرة الأرضية اختيار بلد وتوسيط الخريطة وتقييد البحث، بينما يتيح جميع البلدان البحث عالميًا. يبدّل زر المظهر بين الفاتح والداكن دون عكس ألوان صور الخريطة.'],
    ['هل قياسات حركة المرور ITS حقيقية؟', 'تعرض الخدمة المرتبطة حاليًا محاكاة اصطناعية؛ ففي سيناريو الازدحام تُنشأ مركبات بسرعة 8 كم/س مقارنة بمرجع 40 كم/س. تنتظر القاعدة 30 ثانية من الأدلة المناسبة قبل التنبيه وتُبقي السبب غير محدد؛ فهي لا تؤكد وقوع حوادث ولا تصف حركة المرور الحقيقية. يوسّط عرض الكاميرا على الخريطة موقعًا توضيحيًا دون تغيير مساراتك.'],
    ['ما البيانات التي تُشارك وهل تعالج هذه المساعدة حالات الطوارئ؟', 'عند سؤال الذكاء الاصطناعي يُرسل سؤالك للإجابة دون إرفاق البلاغات أو سجل المحادثة تلقائيًا؛ لا تُدخل بيانات خاصة. يُستخدم GPS أثناء الجلسة دون حفظ سجل للرحلات، ولا يحفظ ITS صورًا أو فيديو أو وجوهًا أو لوحات مركبات. هذه المساعدة ليست خدمة طوارئ؛ استخدم القنوات الرسمية عند الحاجة.'],
  ],
  zh: [
    ['如何安装 SafeRoute，哪些功能可以离线使用？', '在兼容的浏览器中选择“安装”；在 iPhone 上打开 Safari，选择“分享”→“添加到主屏幕”。首次加载后，界面和内置文本可以离线使用，但地图、搜索、路线、Firebase 和 ITS 需要联网。'],
    ['为什么看不到我的位置，或者 GPS 停止工作？', '请通过 HTTPS 打开 SafeRoute，并在浏览器和设备设置中允许定位。保持应用在前台：锁屏或切换应用时，浏览器可能暂停 GPS，定位精度较低也可能限制导航提示。请在车辆停稳时设置导航。'],
    ['如何搜索目的地并沿路线导航？', '输入起点和终点，选择搜索建议和路线，再点击“开始导航”。SafeRoute 会在应用内沿所选路线导航，偏离时可手动请求重新计算。Geoapify 提供的是不含实时路况的预估时间，并不保证路线安全。'],
    ['提交报告后会发生什么？', '点击“报告”，选择类别和大致位置，不要填写姓名、电话号码或其他个人信息。报告需要审核，只有通过审核的报告才会公开显示。没有报告不代表某个地点安全。'],
    ['如何创建账户或登录？', '在“登录／创建账户”中使用电子邮箱和密码。Firebase 项目必须正确配置 Authentication、邮箱／密码提供方和授权域名；未连接 Firebase 的演示模式无法创建真实账户。如果操作失败，请检查应用提示和网络连接；此帮助功能无法修改你的账户。'],
    ['地图无法加载或显示其他国家时怎么办？', '请检查网络，并在出现按钮时选择“重试地图”；地图、搜索和路线依赖 Geoapify 及项目配置。点击地球按钮可选择国家、将地图定位到该国并限定搜索范围；“所有国家”支持全球搜索。明暗主题切换不会反转地图图片的颜色。'],
    ['ITS 交通测量数据是真实的吗？', '当前关联服务展示的是合成演示：拥堵场景生成速度为 8 公里／小时的车辆，并以 40 公里／小时作为参考值。规则在收集到 30 秒符合条件的观测后才发出提醒，原因仍标为未确定；它不确认事故，也不描述真实路况。点击“在地图上查看摄像头”只会定位到示意位置，不会改变你的路线。'],
    ['会分享哪些数据，这项帮助能处理紧急情况吗？', '咨询 AI 时会发送你的问题以获取回答，不会自动附上报告或对话历史；请勿输入私人信息。GPS 仅在会话中使用，不保存行程历史，ITS 也不保存图片、视频、人脸或车牌。这不是紧急救助服务；必要时请使用官方求助渠道。'],
  ],
};

const catalog = Object.freeze(Object.fromEntries(Object.entries(content).map(([language, rows]) => [
  language,
  Object.freeze(rows.map(([question, answer], index) => Object.freeze({id: articleIds[index], question, answer}))),
])));
for (const rows of Object.values(content)) {
  rows.forEach(Object.freeze);
  Object.freeze(rows);
}
Object.freeze(content);

export function getSupportArticles(language = 'es') {
  const code = typeof language === 'string' ? language.trim().toLowerCase().split(/[-_]/)[0] : 'es';
  const articles = Object.hasOwn(catalog, code) ? catalog[code] : catalog.es;
  return articles.map(article => ({...article}));
}

// Contact is an optional user-visible handoff, never an automatic message.
// Accept only a plain mailbox or the exact official WhatsApp destinations.
export function safeSupportContactUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 2048
      || value.includes('#') || /[\u0000-\u0020\u007f-\u009f\\]/.test(value)) return '';
  if (/^mailto:/i.test(value)) {
    const mailbox = value.slice(7);
    return /^[A-Za-z0-9._+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(mailbox)
      ? `mailto:${mailbox}` : '';
  }
  let url;
  try { url = new URL(value); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port) return '';
  if (url.hostname === 'wa.me') {
    return /^\/[0-9]{6,16}$/.test(url.pathname) && !value.includes('?') ? url.href : '';
  }
  if (['api.whatsapp.com', 'web.whatsapp.com'].includes(url.hostname) && url.pathname === '/send') {
    const parameters = [...url.searchParams];
    return parameters.length === 1 && parameters[0][0] === 'phone' && /^[0-9]{6,16}$/.test(parameters[0][1])
      ? url.href : '';
  }
  return '';
}
