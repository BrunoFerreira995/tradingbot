use std::{
  collections::HashMap,
  fs::{self, File, OpenOptions},
  net::{SocketAddr, TcpListener, TcpStream},
  path::{Path, PathBuf},
  process::{Child, Command, Stdio},
  sync::{
    atomic::{AtomicI32, Ordering},
    Mutex,
  },
  thread,
  time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, RunEvent};

const API_PORT: &str = "3201";
const WEB_PORT: &str = "3202";
static SIGNAL_FD: AtomicI32 = AtomicI32::new(-1);

struct EmbeddedServers(Mutex<Vec<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .manage(EmbeddedServers(Mutex::new(Vec::new())))
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.show();
        }
      } else {
        let handle = app.handle().clone();
        thread::spawn(move || {
          if let Err(error) = start_embedded(&handle) {
            eprintln!("[embedded] {error}");
            stop_embedded(&handle);
            show_error(&handle, &error);
          }
        });
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  install_signal_handlers(app.handle().clone());

  app.run(|handle, event| {
    if let RunEvent::Exit = event {
      stop_embedded(handle);
    }
  });
}

fn install_signal_handlers(handle: AppHandle) {
  let mut fds = [0i32; 2];
  if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
    return;
  }
  SIGNAL_FD.store(fds[1], Ordering::SeqCst);
  unsafe {
    libc::signal(
      libc::SIGTERM,
      handle_signal as *const () as libc::sighandler_t,
    );
    libc::signal(
      libc::SIGINT,
      handle_signal as *const () as libc::sighandler_t,
    );
  }
  thread::spawn(move || {
    let mut byte = [0u8; 1];
    loop {
      let read = unsafe { libc::read(fds[0], byte.as_mut_ptr() as *mut libc::c_void, 1) };
      if read > 0 {
        stop_embedded(&handle);
        handle.exit(0);
        break;
      }
      if read == 0 {
        break;
      }
      if std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
        break;
      }
    }
  });
}

extern "C" fn handle_signal(_signal: libc::c_int) {
  let fd = SIGNAL_FD.load(Ordering::SeqCst);
  if fd >= 0 {
    let byte = [1u8; 1];
    unsafe {
      libc::write(fd, byte.as_ptr() as *const libc::c_void, 1);
    }
  }
}

fn start_embedded(handle: &AppHandle) -> Result<(), String> {
  let embed = embed_dir(handle)?;
  let bun = embed.join("bun");
  if !bun.is_file() {
    return Err(format!(
      "Runtime embutido não encontrado em {}",
      bun.display()
    ));
  }

  let app_data = handle
    .path()
    .app_data_dir()
    .map_err(|error| format!("Diretório de dados indisponível: {error}"))?;
  fs::create_dir_all(&app_data)
    .map_err(|error| format!("Não foi possível criar {}: {error}", app_data.display()))?;

  let env_file = env_file_path(&app_data);
  if !env_file.exists() {
    write_default_env(&env_file)?;
  }
  let env = load_env_file(&env_file);

  let api_log = app_data.join("api.log");
  let web_log = app_data.join("web.log");
  let web_dir = embed.join("web").join("apps").join("web");
  let database_url = start_database(handle, &embed, &app_data, &env)?;

  if !port_open(API_PORT) {
    let child = spawn(
      &bun,
      &embed.join("api.js"),
      &embed,
      &env,
      &[
        ("API_PORT", API_PORT.to_string()),
        ("WEB_ORIGIN", web_origin()),
        ("AUTO_MIGRATE", "true".to_string()),
        ("MIGRATIONS_DIR", embed.join("migrations").display().to_string()),
        ("TRADINGBOT_ROOT", embed.display().to_string()),
        ("BUN_BINARY", bun.display().to_string()),
        ("DATABASE_URL", database_url),
        ("NODE_ENV", "production".to_string()),
      ],
      &api_log,
    )?;
    register_child(handle, child);
  }

  if !port_open(WEB_PORT) {
    let child = spawn(
      &bun,
      &web_dir.join("server.js"),
      &web_dir,
      &env,
      &[
        ("PORT", WEB_PORT.to_string()),
        ("HOSTNAME", "127.0.0.1".to_string()),
        ("NODE_ENV", "production".to_string()),
        ("API_INTERNAL_URL", api_origin()),
        ("DASHBOARD_AUTH_DISABLED", "true".to_string()),
        ("NEXT_TELEMETRY_DISABLED", "1".to_string()),
      ],
      &web_log,
    )?;
    register_child(handle, child);
  }

  if !wait_for_ports(Duration::from_secs(45)) {
    stop_embedded(handle);
    return Err(format!(
      "A API ou o dashboard não respondeu a tempo.\n\nLogs:\n{}\n{}",
      api_log.display(),
      web_log.display()
    ));
  }

  let target = format!("http://127.0.0.1:{WEB_PORT}");
  let ui_handle = handle.clone();
  let _ = handle.run_on_main_thread(move || {
    if let Some(window) = ui_handle.get_webview_window("main") {
      match tauri::Url::parse(&target) {
        Ok(url) => {
          if window.navigate(url).is_err() {
            let _ = window.eval(&format!("window.location.replace('{target}')"));
          }
        }
        Err(_) => {
          let _ = window.eval(&format!("window.location.replace('{target}')"));
        }
      }
      let _ = window.show();
      let _ = window.set_focus();
    }
  });
  Ok(())
}

fn start_database(
  handle: &AppHandle,
  embed: &Path,
  app_data: &Path,
  env: &HashMap<String, String>,
) -> Result<String, String> {
  let mode = env
    .get("DATABASE_MODE")
    .map(|value| value.trim().to_ascii_lowercase())
    .unwrap_or_else(|| "embedded".to_string());
  if mode == "external" {
    return Ok(
      env
        .get("DATABASE_URL")
        .cloned()
        .unwrap_or_else(|| "postgres://trader:trader@localhost:5432/tradingbot".into()),
    );
  }

  let pg = embed.join("postgres");
  let initdb = pg.join("bin").join("initdb");
  let postgres = pg.join("bin").join("postgres");
  let createdb = pg.join("bin").join("createdb");
  for binary in [&initdb, &postgres, &createdb] {
    if !binary.is_file() {
      return Err(format!(
        "PostgreSQL embutido incompleto: {} não encontrado",
        binary.display()
      ));
    }
  }

  let data = app_data.join("postgres-data");
  let socket = app_data.join("postgres-socket");
  fs::create_dir_all(&socket)
    .map_err(|error| format!("Não foi possível criar {}: {error}", socket.display()))?;

  let pid_file = data.join("postmaster.pid");
  if pid_file.exists() {
    let pid = read_postmaster_pid(&pid_file);
    if let Some(pid) = pid
      && process_alive(pid)
    {
      if !is_bundled_postgres(pid, &pg) {
        return Err(format!(
          "O arquivo {} aponta para um processo que não é o PostgreSQL embutido",
          pid_file.display()
        ));
      }
      if let Some(port) = read_postmaster_port(&pid_file) {
        return Ok(format!(
          "postgres://trader@127.0.0.1:{port}/tradingbot?sslmode=disable"
        ));
      }
    }
    let _ = fs::remove_file(&pid_file);
  }

  if !data.join("PG_VERSION").is_file() {
    let _ = fs::remove_dir_all(&data);
    fs::create_dir_all(&data)
      .map_err(|error| format!("Não foi possível criar {}: {error}", data.display()))?;
    let log = app_data.join("postgres-init.log");
    let stdout = open_log(&log)?;
    let stderr = stdout
      .try_clone()
      .map_err(|error| format!("Não foi possível abrir {}: {error}", log.display()))?;
    let status = Command::new(&initdb)
      .arg("-D")
      .arg(&data)
      .args(["-U", "trader", "--auth=trust", "--no-locale", "--encoding=UTF8"])
      .env("LC_ALL", "C")
      .stdin(Stdio::null())
      .stdout(Stdio::from(stdout))
      .stderr(Stdio::from(stderr))
      .status()
      .map_err(|error| format!("Não foi possível executar initdb: {error}"))?;
    if !status.success() {
      return Err(format!(
        "Não foi possível inicializar o PostgreSQL embutido.\n\nLog: {}",
        log.display()
      ));
    }
  }

  let port = free_port()?;
  let log = app_data.join("postgres.log");
  let stdout = open_log(&log)?;
  let stderr = stdout
    .try_clone()
    .map_err(|error| format!("Não foi possível abrir {}: {error}", log.display()))?;
  let mut command = Command::new(&postgres);
  command
    .arg("-D")
    .arg(&data)
    .arg("-p")
    .arg(port.to_string())
    .arg("-k")
    .arg(&socket)
    .args(["-c", "listen_addresses=127.0.0.1"])
    .current_dir(&pg)
    .env("LC_ALL", "C")
    .stdin(Stdio::null())
    .stdout(Stdio::from(stdout))
    .stderr(Stdio::from(stderr));
  let child = command
    .spawn()
    .map_err(|error| format!("Não foi possível iniciar o PostgreSQL embutido: {error}"))?;
  register_child(handle, child);

  if !wait_for_port(port, Duration::from_secs(30)) {
    return Err(format!(
      "O PostgreSQL embutido não iniciou a tempo.\n\nLog: {}",
      log.display()
    ));
  }

  let output = Command::new(&createdb)
    .args(["-h", "127.0.0.1", "-p"])
    .arg(port.to_string())
    .args(["-U", "trader", "tradingbot"])
    .env("PGCONNECT_TIMEOUT", "10")
    .output()
    .map_err(|error| format!("Não foi possível executar createdb: {error}"))?;
  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.contains("already exists") {
      return Err(format!(
        "Não foi possível criar o banco tradingbot: {}",
        stderr.trim()
      ));
    }
  }

  Ok(format!(
    "postgres://trader@127.0.0.1:{port}/tradingbot?sslmode=disable"
  ))
}

fn read_postmaster_pid(path: &Path) -> Option<u32> {
  fs::read_to_string(path)
    .ok()?
    .lines()
    .next()?
    .trim()
    .parse()
    .ok()
}

fn read_postmaster_port(path: &Path) -> Option<u16> {
  fs::read_to_string(path)
    .ok()?
    .lines()
    .nth(3)?
    .trim()
    .parse()
    .ok()
}

fn process_alive(pid: u32) -> bool {
  Command::new("kill")
    .arg("-0")
    .arg(pid.to_string())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .status()
    .map(|status| status.success())
    .unwrap_or(false)
}

fn is_bundled_postgres(pid: u32, pg: &Path) -> bool {
  let Ok(output) = Command::new("ps")
    .args(["-ww", "-p"])
    .arg(pid.to_string())
    .args(["-o", "command="])
    .output()
  else {
    return false;
  };
  let command = String::from_utf8_lossy(&output.stdout);
  command.contains("postgres") && command.contains(&pg.display().to_string())
}

fn free_port() -> Result<u16, String> {
  let listener = TcpListener::bind(("127.0.0.1", 0))
    .map_err(|error| format!("Não foi possível reservar uma porta local: {error}"))?;
  listener
    .local_addr()
    .map(|address| address.port())
    .map_err(|error| format!("Não foi possível obter a porta local: {error}"))
}

fn wait_for_port(port: u16, timeout: Duration) -> bool {
  let start = Instant::now();
  loop {
    if port_open(&port.to_string()) {
      return true;
    }
    if start.elapsed() >= timeout {
      return false;
    }
    thread::sleep(Duration::from_millis(250));
  }
}

fn embed_dir(handle: &AppHandle) -> Result<PathBuf, String> {
  if let Ok(path) = std::env::var("TRADINGBOT_EMBED_DIR") {
    return Ok(PathBuf::from(path));
  }
  handle
    .path()
    .resource_dir()
    .map(|dir| dir.join("embed"))
    .map_err(|error| format!("Recursos do aplicativo indisponíveis: {error}"))
}

fn env_file_path(app_data: &Path) -> PathBuf {
  if let Ok(path) = std::env::var("TRADINGBOT_ENV_FILE") {
    return PathBuf::from(path);
  }
  app_data.join(".env")
}

fn api_origin() -> String {
  format!("http://127.0.0.1:{API_PORT}")
}

fn web_origin() -> String {
  format!("http://127.0.0.1:{WEB_PORT}")
}

fn spawn(
  bun: &Path,
  script: &Path,
  cwd: &Path,
  env: &HashMap<String, String>,
  extra: &[(&str, String)],
  log_path: &Path,
) -> Result<Child, String> {
  let stdout = open_log(log_path)?;
  let stderr = stdout
    .try_clone()
    .map_err(|error| format!("Não foi possível abrir {}: {error}", log_path.display()))?;
  let mut command = Command::new(bun);
  command
    .arg(script)
    .current_dir(cwd)
    .stdin(Stdio::null())
    .stdout(Stdio::from(stdout))
    .stderr(Stdio::from(stderr));
  for (key, value) in env {
    command.env(key, value);
  }
  for (key, value) in extra {
    command.env(key, value);
  }
  command.spawn().map_err(|error| {
    format!(
      "Não foi possível iniciar {}: {error}",
      script.display()
    )
  })
}

fn open_log(path: &Path) -> Result<File, String> {
  OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)
    .map_err(|error| format!("Não foi possível abrir {}: {error}", path.display()))
}

fn register_child(handle: &AppHandle, child: Child) {
  let state = handle.state::<EmbeddedServers>();
  if let Ok(mut children) = state.0.lock() {
    children.push(child);
  }
}

fn stop_embedded(handle: &AppHandle) {
  let state = handle.state::<EmbeddedServers>();
  let Ok(mut children) = state.0.lock() else {
    return;
  };
  for child in children.iter_mut().rev() {
    terminate(child);
  }
  children.clear();
}

fn terminate(child: &mut Child) {
  let pid = child.id().to_string();
  let _ = Command::new("kill").arg("-TERM").arg(&pid).status();
  let deadline = Instant::now() + Duration::from_secs(3);
  while Instant::now() < deadline {
    match child.try_wait() {
      Ok(Some(_)) => return,
      Ok(None) => thread::sleep(Duration::from_millis(100)),
      Err(_) => break,
    }
  }
  let _ = child.kill();
  let _ = child.wait();
}

fn port_open(port: &str) -> bool {
  let Ok(port) = port.parse::<u16>() else {
    return false;
  };
  let address = SocketAddr::from(([127, 0, 0, 1], port));
  TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok()
}

fn wait_for_ports(timeout: Duration) -> bool {
  let start = Instant::now();
  loop {
    if port_open(WEB_PORT) && port_open(API_PORT) {
      return true;
    }
    if start.elapsed() >= timeout {
      return false;
    }
    thread::sleep(Duration::from_millis(250));
  }
}

fn show_error(handle: &AppHandle, message: &str) {
  let ui_handle = handle.clone();
  let message = message
    .replace('\\', "\\\\")
    .replace('\'', "\\'")
    .replace('\n', "\\n");
  let _ = handle.run_on_main_thread(move || {
    if let Some(window) = ui_handle.get_webview_window("main") {
      let script = format!(
        "document.getElementById('loader').style.display='none';\
         document.getElementById('status').textContent='{message}';"
      );
      let _ = window.eval(&script);
      let _ = window.show();
    }
  });
}

fn load_env_file(path: &Path) -> HashMap<String, String> {
  let mut values = HashMap::new();
  let Ok(contents) = fs::read_to_string(path) else {
    return values;
  };
  for raw in contents.lines() {
    let line = raw.trim();
    if line.is_empty() || line.starts_with('#') {
      continue;
    }
    let Some((key, value)) = line.split_once('=') else {
      continue;
    };
    let key = key.trim();
    if key.is_empty() {
      continue;
    }
    values.insert(key.to_string(), unquote(value.trim()).to_string());
  }
  values
}

fn unquote(value: &str) -> &str {
  if value.len() >= 2 {
    let bytes = value.as_bytes();
    if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
      || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
    {
      return &value[1..value.len() - 1];
    }
  }
  value
}

fn write_default_env(path: &Path) -> Result<(), String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)
      .map_err(|error| format!("Não foi possível criar {}: {error}", parent.display()))?;
  }
  let content = format!(
    "# Configuração local do TradingBot embutido.\n\
     # Edite este arquivo e reinicie o aplicativo após alterações.\n\
     # embedded usa o PostgreSQL incluído no app; external usa DATABASE_URL.\n\
     DATABASE_MODE=embedded\n\
     # DATABASE_URL=postgres://trader:trader@localhost:5432/tradingbot\n\
     ADMIN_API_KEY={}\n\
     DASHBOARD_USER=admin\n\
     DASHBOARD_PASSWORD={}\n\
     TRADINGVIEW_WEBHOOK_SECRET={}\n\
     TRADING_MODE=auto\n\
     AUTO_TRADING_ENABLED=false\n\
     STRATEGY_RUNNER=meanrev-bb-rsi-v1\n\
     STRATEGY_TIMEFRAME=H1\n\
     MT5_PRIMARY_SYMBOL=XAUUSD\n\
     MT5_SYMBOLS=XAUUSD\n",
    random_hex(32),
    random_hex(24),
    random_hex(32)
  );
  fs::write(path, content)
    .map_err(|error| format!("Não foi possível criar {}: {error}", path.display()))
}

fn random_hex(bytes: usize) -> String {
  let length = bytes.to_string();
  if let Ok(output) = Command::new("openssl")
    .args(["rand", "-hex", &length])
    .output()
    && output.status.success()
  {
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !value.is_empty() {
      return value;
    }
  }
  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|time| time.as_nanos())
    .unwrap_or_default();
  format!("{now:x}{:x}{:x}", std::process::id(), bytes)
}
