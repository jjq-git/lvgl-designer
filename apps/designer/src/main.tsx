import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';

// 注:不用 StrictMode —— 双挂载会让 WASM 运行时(单实例、不可重初始化)重复创建
// (design/02 §3.4;CanvasStage 内另有 bootRef 单例守护)。
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
