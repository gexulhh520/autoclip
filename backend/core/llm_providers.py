"""
多模型提供商统一接口
支持OpenAI、Gemini、硅基流动、阿里DashScope等
"""
import json
import logging
import os
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Union
from enum import Enum
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)

class ProviderType(Enum):
    """模型提供商类型"""
    DASHSCOPE = "dashscope"  # 阿里通义千问
    OPENAI = "openai"        # OpenAI
    GEMINI = "gemini"        # Google Gemini
    SILICONFLOW = "siliconflow"  # 硅基流动
    OLLAMA = "ollama"        # 本地 Ollama

@dataclass
class ModelInfo:
    """模型信息"""
    name: str
    display_name: str
    provider: ProviderType
    max_tokens: int
    cost_per_token: Optional[float] = None
    description: Optional[str] = None

@dataclass
class LLMResponse:
    """LLM响应"""
    content: str
    usage: Optional[Dict[str, Any]] = None
    model: Optional[str] = None
    finish_reason: Optional[str] = None

class LLMProvider(ABC):
    """LLM提供商抽象基类"""
    
    def __init__(self, api_key: str, model_name: str, **kwargs):
        self.api_key = api_key
        self.model_name = model_name
        self.kwargs = kwargs
    
    @abstractmethod
    def call(self, prompt: str, input_data: Any = None, **kwargs) -> LLMResponse:
        """
        调用模型API
        
        Args:
            prompt: 提示词
            input_data: 输入数据
            **kwargs: 其他参数
            
        Returns:
            LLMResponse: 模型响应
        """
        pass
    
    @abstractmethod
    def test_connection(self) -> bool:
        """
        测试API连接
        
        Returns:
            bool: 连接是否成功
        """
        pass
    
    @abstractmethod
    def get_available_models(self) -> List[ModelInfo]:
        """
        获取可用模型列表
        
        Returns:
            List[ModelInfo]: 可用模型列表
        """
        pass
    
    def _build_full_input(self, prompt: str, input_data: Any = None) -> str:
        """构建完整的输入"""
        if input_data:
            if isinstance(input_data, dict):
                # 紧凑 JSON，避免 indent 放大长字幕块的 token 占用
                return (
                    f"{prompt}\n\n输入内容：\n"
                    f"{json.dumps(input_data, ensure_ascii=False, separators=(',', ':'))}"
                )
            else:
                return f"{prompt}\n\n输入内容：\n{input_data}"
        return prompt

class DashScopeProvider(LLMProvider):
    """阿里DashScope提供商"""
    
    def __init__(self, api_key: str, model_name: str = "qwen-plus", **kwargs):
        super().__init__(api_key, model_name, **kwargs)
        # 模式切换: native (SDK Generation.call) | compatible (OpenAI兼容)
        self.mode = (kwargs.get("mode") or os.getenv("DASHSCOPE_MODE") or "native").lower()
        # 兼容模式 base_url
        self.base_url = kwargs.get("base_url", "https://dashscope.aliyuncs.com/compatible-mode/v1")
        # 原生模式 SDK
        self._ds_generation = None
        if self.mode == "native":
            try:
                from dashscope import Generation
                self._ds_generation = Generation
            except ImportError:
                raise ImportError("请安装dashscope: pip install dashscope")
    
    def call(self, prompt: str, input_data: Any = None, **kwargs) -> LLMResponse:
        """调用DashScope API（mode: native|compatible）"""
        masked_key = self.api_key[:3] + "***" + self.api_key[-2:] if self.api_key else ""
        logger.info(f"[DashScope] mode={self.mode} model={self.model_name} base_url={self.base_url if self.mode=='compatible' else 'sdk-generation'} key={masked_key}")
        logger.info(f"[DashScope] 实际使用的API key: {self.api_key}")
        logger.info(f"[DashScope] 传入的kwargs: {kwargs}")
        if self.mode == "native":
            try:
                # 确保使用传入的API key，临时设置环境变量
                old_api_key = os.getenv("DASHSCOPE_API_KEY")
                os.environ["DASHSCOPE_API_KEY"] = self.api_key
                
                full_input = self._build_full_input(prompt, input_data)
                resp = self._ds_generation.call(
                    model=self.model_name,
                    prompt=full_input,
                    api_key=self.api_key,
                    stream=False,
                    **kwargs
                )
                
                # 恢复原来的环境变量
                if old_api_key is not None:
                    os.environ["DASHSCOPE_API_KEY"] = old_api_key
                elif "DASHSCOPE_API_KEY" in os.environ:
                    del os.environ["DASHSCOPE_API_KEY"]
                if resp and getattr(resp, 'status_code', 200) == 200:
                    if getattr(resp, 'output', None) and getattr(resp.output, 'text', None) is not None:
                        return LLMResponse(
                            content=resp.output.text,
                            model=self.model_name,
                            finish_reason=getattr(resp.output, 'finish_reason', None)
                        )
                    finish_reason = getattr(resp.output, 'finish_reason', 'unknown') if getattr(resp, 'output', None) else 'unknown'
                    logger.warning(f"API请求成功，但输出为空。结束原因: {finish_reason}")
                    return LLMResponse(content="")
                code = getattr(resp, 'code', 'N/A')
                message = getattr(resp, 'message', '未知API错误')
                raise Exception(f"API调用失败 - Status: {getattr(resp,'status_code', 'N/A')}, Code: {code}, Message: {message}")
            except Exception as e:
                logger.error(f"DashScope(native)调用失败: {str(e)}")
                raise
        else:
            # compatible
            try:
                import requests
                full_input = self._build_full_input(prompt, input_data)
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                }
                payload = {
                    "model": self.model_name,
                    "messages": [{"role": "user", "content": full_input}],
                    "stream": False,
                }
                payload.update({k: v for k, v in kwargs.items() if v is not None})
                url = f"{self.base_url}/chat/completions"
                resp = requests.post(url, headers=headers, json=payload, timeout=30)
                if resp.status_code != 200:
                    try:
                        err = resp.json()
                    except Exception:
                        err = {"message": resp.text}
                    raise Exception(f"API调用失败 - Status: {resp.status_code}, Message: {err}")
                data = resp.json()
                content = data["choices"][0]["message"]["content"]
                usage = data.get("usage")
                finish_reason = data["choices"][0].get("finish_reason")
                return LLMResponse(content=content, usage=usage, model=self.model_name, finish_reason=finish_reason)
            except Exception as e:
                logger.error(f"DashScope(compatible)调用失败: {str(e)}")
                raise
    
    def test_connection(self) -> bool:
        """测试DashScope连接"""
        try:
            # 首先验证API Key格式
            if not self.api_key or len(self.api_key.strip()) < 10:
                logger.error("API Key为空或过短")
                return False
            
            # 检查API Key格式（DashScope API Key通常是sk-开头）
            if not self.api_key.startswith("sk-"):
                logger.warning(f"API Key格式可能不正确，期望以'sk-'开头，实际: {self.api_key[:10]}...")
                # 不直接返回False，因为有些API Key可能格式不同
            
            # 使用简单的测试调用，避免复杂的API验证
            try:
                # 直接调用call方法进行测试
                response = self.call("测试", max_tokens=1)
                if response and response.content:
                    logger.info("DashScope API连接测试成功")
                    return True
                else:
                    logger.error("DashScope API测试返回空响应")
                    return False
                    
            except Exception as e:
                logger.error(f"DashScope API测试失败: {str(e)}")
                return False
                
        except Exception as e:
            logger.error(f"DashScope连接测试失败: {e}")
            return False
    
    def get_available_models(self) -> List[ModelInfo]:
        """获取DashScope可用模型"""
        return [
            ModelInfo(
                name="qwen-plus",
                display_name="通义千问Plus",
                provider=ProviderType.DASHSCOPE,
                max_tokens=8192,
                description="阿里云通义千问Plus模型"
            ),
            ModelInfo(
                name="qwen-max",
                display_name="通义千问Max",
                provider=ProviderType.DASHSCOPE,
                max_tokens=8192,
                description="阿里云通义千问Max模型"
            ),
            ModelInfo(
                name="qwen-turbo",
                display_name="通义千问Turbo",
                provider=ProviderType.DASHSCOPE,
                max_tokens=8192,
                description="阿里云通义千问Turbo模型"
            )
        ]

class OpenAIProvider(LLMProvider):
    """OpenAI提供商"""
    
    def __init__(self, api_key: str, model_name: str = "gpt-3.5-turbo", **kwargs):
        super().__init__(api_key, model_name, **kwargs)
        try:
            import openai
            self.client = openai.OpenAI(api_key=api_key)
        except ImportError:
            raise ImportError("请安装openai: pip install openai")
    
    def call(self, prompt: str, input_data: Any = None, **kwargs) -> LLMResponse:
        """调用OpenAI API"""
        try:
            full_input = self._build_full_input(prompt, input_data)
            
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[{"role": "user", "content": full_input}],
                **kwargs
            )
            
            content = response.choices[0].message.content
            usage = {
                "prompt_tokens": response.usage.prompt_tokens,
                "completion_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens
            } if response.usage else None
            
            return LLMResponse(
                content=content,
                usage=usage,
                model=self.model_name,
                finish_reason=response.choices[0].finish_reason
            )
            
        except Exception as e:
            logger.error(f"OpenAI调用失败: {str(e)}")
            raise
    
    def test_connection(self) -> bool:
        """测试OpenAI连接"""
        try:
            # 验证API Key格式
            if not self.api_key or len(self.api_key.strip()) < 10:
                logger.error("OpenAI API Key为空或过短")
                return False
            
            # 检查API Key格式（OpenAI API Key通常是sk-开头）
            if not self.api_key.startswith("sk-"):
                logger.warning(f"OpenAI API Key格式可能不正确，期望以'sk-'开头，实际: {self.api_key[:10]}...")
            
            # 使用最简单的测试
            response = self.call("测试", max_tokens=1)
            return response and response.content is not None
        except Exception as e:
            logger.error(f"OpenAI连接测试失败: {e}")
            return False
    
    def get_available_models(self) -> List[ModelInfo]:
        """获取OpenAI可用模型"""
        return [
            ModelInfo(
                name="gpt-3.5-turbo",
                display_name="GPT-3.5 Turbo",
                provider=ProviderType.OPENAI,
                max_tokens=4096,
                description="OpenAI GPT-3.5 Turbo模型"
            ),
            ModelInfo(
                name="gpt-4",
                display_name="GPT-4",
                provider=ProviderType.OPENAI,
                max_tokens=8192,
                description="OpenAI GPT-4模型"
            ),
            ModelInfo(
                name="gpt-4-turbo",
                display_name="GPT-4 Turbo",
                provider=ProviderType.OPENAI,
                max_tokens=128000,
                description="OpenAI GPT-4 Turbo模型"
            )
        ]

class GeminiProvider(LLMProvider):
    """Google Gemini提供商"""
    
    def __init__(self, api_key: str, model_name: str = "gemini-2.5-flash", **kwargs):
        super().__init__(api_key, model_name, **kwargs)
        try:
            # New unified Google GenAI SDK (replaces the deprecated
            # google-generativeai package).
            from google import genai
            self.client = genai.Client(api_key=api_key)
        except ImportError:
            raise ImportError("请安装google-genai: pip install google-genai")

    def call(self, prompt: str, input_data: Any = None, **kwargs) -> LLMResponse:
        """调用Gemini API"""
        try:
            full_input = self._build_full_input(prompt, input_data)

            # Map a max-tokens hint onto the new SDK's config object if present.
            config = None
            max_tokens = kwargs.get("max_tokens") or kwargs.get("max_output_tokens")
            if max_tokens:
                from google.genai import types
                config = types.GenerateContentConfig(max_output_tokens=max_tokens)

            response = self.client.models.generate_content(
                model=self.model_name,
                contents=full_input,
                config=config,
            )

            return LLMResponse(
                content=response.text,
                model=self.model_name,
                finish_reason=getattr(response, 'finish_reason', None)
            )

        except Exception as e:
            logger.error(f"Gemini调用失败: {str(e)}")
            raise
    
    def test_connection(self) -> bool:
        """测试Gemini连接"""
        try:
            # 使用简单的测试提示
            response = self.call("测试", max_tokens=10)
            # 检查响应是否有效
            if response and response.content:
                return True
            return False
        except Exception as e:
            logger.error(f"Gemini连接测试失败: {e}")
            return False
    
    def get_available_models(self) -> List[ModelInfo]:
        """获取Gemini可用模型"""
        return [
            ModelInfo(
                name="gemini-2.5-flash",
                display_name="Gemini 2.5 Flash",
                provider=ProviderType.GEMINI,
                max_tokens=1000000,
                description="Google Gemini 2.5 Flash模型"
            ),
            ModelInfo(
                name="gemini-1.5-pro",
                display_name="Gemini 1.5 Pro",
                provider=ProviderType.GEMINI,
                max_tokens=2000000,
                description="Google Gemini 1.5 Pro模型"
            ),
            ModelInfo(
                name="gemini-1.5-flash",
                display_name="Gemini 1.5 Flash",
                provider=ProviderType.GEMINI,
                max_tokens=1000000,
                description="Google Gemini 1.5 Flash模型"
            )
        ]

class OllamaProvider(LLMProvider):
    """本地 Ollama 提供商（OpenAI 兼容 API）"""

    DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1"
    DEFAULT_MODEL = "qwen2.5vl:7b"
    CURATED_MODELS = (
        ("qwen2.5vl:7b", "Qwen 2.5 VL 7B", "推荐中文视频字幕分析"),
        ("gemma4:12b", "Gemma 4 12B", "更大参数，适合复杂内容理解"),
    )

    # Ollama 支持的常见上下文档位
    _CTX_STEPS = (8192, 16384, 32768, 65536, 131072)

    def __init__(self, api_key: str = "ollama", model_name: str = None, **kwargs):
        super().__init__(api_key or "ollama", model_name or self.DEFAULT_MODEL, **kwargs)
        self.base_url = (kwargs.get("base_url") or os.getenv("OLLAMA_BASE_URL") or self.DEFAULT_BASE_URL).rstrip("/")
        self.num_ctx = int(kwargs.get("num_ctx") or os.getenv("OLLAMA_NUM_CTX") or 32768)
        self.num_predict = int(kwargs.get("num_predict") or os.getenv("OLLAMA_NUM_PREDICT") or 4096)

    def _chat_completions_url(self) -> str:
        return f"{self.base_url}/chat/completions"

    def _chat_api_url(self) -> str:
        """Ollama 原生 chat API（支持 think / num_ctx）。"""
        return f"{self._root_url()}/api/chat"

    def _root_url(self) -> str:
        if self.base_url.endswith("/v1"):
            return self.base_url[:-3]
        return self.base_url

    def _resolve_num_ctx(self, prompt_chars: int, num_predict: int, requested: int) -> int:
        """按 prompt 体量自动选择 num_ctx，避免 prompt 占满上下文导致只输出 1 个 token。"""
        # 中文/混排字幕实测约 1.1 字符/token
        est_prompt_tokens = int(prompt_chars / 1.1) + 512
        needed = est_prompt_tokens + num_predict + 2048
        floor = max(requested, self.num_ctx)
        for size in self._CTX_STEPS:
            if size >= needed and size >= floor:
                if size > floor:
                    logger.info(
                        "Ollama prompt 约 %d 字符（≈%d tokens），num_ctx 从 %d 提升到 %d",
                        prompt_chars,
                        est_prompt_tokens,
                        floor,
                        size,
                    )
                return size
        return self._CTX_STEPS[-1]

    @staticmethod
    def _is_context_overflow(data: Dict[str, Any], content: str, num_ctx: int) -> bool:
        prompt_eval = data.get("prompt_eval_count") or 0
        eval_count = data.get("eval_count") or 0
        if data.get("done_reason") != "length":
            return False
        if len(content.strip()) >= 50 and eval_count >= 50:
            return False
        return prompt_eval >= max(num_ctx - 256, int(num_ctx * 0.95))

    @staticmethod
    def _extract_message_text(message: Dict[str, Any]) -> str:
        """从 Ollama 响应中提取可用文本（兼容 thinking 模型）。"""
        content = (message.get("content") or "").strip()
        if content:
            return content
        for field in ("reasoning", "thinking"):
            fallback = (message.get(field) or "").strip()
            if fallback:
                logger.warning(
                    "Ollama 返回空 content，已回退使用 %s 字段（建议对结构化任务设置 think=false）",
                    field,
                )
                return fallback
        return ""

    def _post_chat(
        self,
        full_input: str,
        *,
        think: bool,
        num_ctx: int,
        num_predict: int,
        timeout: int,
        extra_options: Dict[str, Any],
    ) -> Dict[str, Any]:
        import requests

        payload = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": full_input}],
            "stream": False,
            "think": think,
            "options": {
                "num_ctx": num_ctx,
                "num_predict": num_predict,
                **extra_options,
            },
        }
        headers = {
            "Authorization": f"Bearer {self.api_key or 'ollama'}",
            "Content-Type": "application/json",
        }
        resp = requests.post(
            self._chat_api_url(),
            headers=headers,
            json=payload,
            timeout=timeout,
        )
        if resp.status_code != 200:
            try:
                err = resp.json()
            except Exception:
                err = {"message": resp.text}
            raise Exception(f"Ollama API调用失败 - Status: {resp.status_code}, Message: {err}")
        return resp.json()

    def call(self, prompt: str, input_data: Any = None, **kwargs) -> LLMResponse:
        """调用 Ollama 原生 chat API（支持 think / num_ctx 自动扩容）。"""
        try:
            full_input = self._build_full_input(prompt, input_data)
            timeout = kwargs.pop("timeout", 300)
            # thinking 模型（如 gemma4）默认会把全部 token 用在 reasoning 里，
            # content 为空，导致流水线后续步骤拿到空 JSON。结构化任务默认关闭 thinking。
            think = kwargs.pop("think", False)
            requested_ctx = int(kwargs.pop("num_ctx", self.num_ctx))
            num_predict = int(kwargs.pop("num_predict", kwargs.pop("max_tokens", self.num_predict)))
            extra_options = {
                key: kwargs[key]
                for key in ("temperature", "top_p", "top_k", "seed")
                if key in kwargs and kwargs[key] is not None
            }

            num_ctx = self._resolve_num_ctx(len(full_input), num_predict, requested_ctx)
            data = self._post_chat(
                full_input,
                think=think,
                num_ctx=num_ctx,
                num_predict=num_predict,
                timeout=timeout,
                extra_options=extra_options,
            )
            message = data.get("message") or {}
            content = self._extract_message_text(message)

            if self._is_context_overflow(data, content, num_ctx):
                larger_steps = [s for s in self._CTX_STEPS if s > num_ctx]
                if larger_steps:
                    retry_ctx = larger_steps[0]
                    logger.warning(
                        "Ollama 上下文不足（prompt=%s tokens, num_ctx=%s, 输出仅 %s 字符），"
                        "自动以 num_ctx=%s 重试",
                        data.get("prompt_eval_count"),
                        num_ctx,
                        len(content),
                        retry_ctx,
                    )
                    num_ctx = retry_ctx
                    data = self._post_chat(
                        full_input,
                        think=think,
                        num_ctx=num_ctx,
                        num_predict=num_predict,
                        timeout=timeout,
                        extra_options=extra_options,
                    )
                    message = data.get("message") or {}
                    content = self._extract_message_text(message)

            usage = {
                "prompt_tokens": data.get("prompt_eval_count"),
                "completion_tokens": data.get("eval_count"),
                "total_tokens": (data.get("prompt_eval_count") or 0) + (data.get("eval_count") or 0),
            }
            finish_reason = data.get("done_reason") or ("stop" if data.get("done") else None)
            if self._is_context_overflow(data, content, num_ctx):
                raise ValueError(
                    f"Ollama 上下文窗口不足：prompt 占用约 {usage.get('prompt_tokens')} tokens，"
                    f"num_ctx={num_ctx} 已无空间生成完整 JSON。"
                    f"请设置环境变量 OLLAMA_NUM_CTX=65536 或换用 qwen2.5vl:7b。"
                )
            if not content.strip() and finish_reason == "length":
                logger.error(
                    "Ollama 响应为空且 finish_reason=length（prompt≈%s tokens, num_ctx=%s）",
                    usage.get("prompt_tokens", "?"),
                    num_ctx,
                )
            return LLMResponse(
                content=content,
                usage=usage,
                model=self.model_name,
                finish_reason=finish_reason,
            )
        except Exception as e:
            logger.error(f"Ollama调用失败: {str(e)}")
            raise

    def test_connection(self) -> bool:
        """测试 Ollama 服务是否可用"""
        try:
            import requests

            resp = requests.get(f"{self._root_url()}/api/tags", timeout=5)
            if resp.status_code == 200:
                return True
            response = self.call("测试", max_tokens=8, timeout=60)
            return bool(response and response.content)
        except Exception as e:
            logger.error(f"Ollama连接测试失败: {e}")
            return False

    def get_available_models(self) -> List[ModelInfo]:
        """获取 Ollama 预设模型，并合并本地已 pull 的模型"""
        models = [
            ModelInfo(
                name=name,
                display_name=display_name,
                provider=ProviderType.OLLAMA,
                max_tokens=32768,
                description=description,
            )
            for name, display_name, description in self.CURATED_MODELS
        ]
        try:
            import requests

            resp = requests.get(f"{self._root_url()}/api/tags", timeout=5)
            if resp.status_code == 200:
                for item in resp.json().get("models", []):
                    name = item.get("name")
                    if not name or any(m.name == name for m in models):
                        continue
                    models.append(
                        ModelInfo(
                            name=name,
                            display_name=name,
                            provider=ProviderType.OLLAMA,
                            max_tokens=32768,
                            description="本地已安装模型",
                        )
                    )
        except Exception as e:
            logger.debug(f"无法从 Ollama 拉取模型列表: {e}")
        return models


class SiliconFlowProvider(LLMProvider):
    """硅基流动提供商"""
    
    def __init__(self, api_key: str, model_name: str = "Qwen/Qwen2.5-7B-Instruct", **kwargs):
        super().__init__(api_key, model_name, **kwargs)
        self.base_url = "https://api.siliconflow.cn/v1"
    
    def call(self, prompt: str, input_data: Any = None, **kwargs) -> LLMResponse:
        """调用硅基流动API"""
        try:
            import requests
            
            full_input = self._build_full_input(prompt, input_data)
            
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            data = {
                "model": self.model_name,
                "messages": [{"role": "user", "content": full_input}],
                "stream": False,
                **kwargs
            }
            
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers=headers,
                json=data,
                timeout=30
            )
            
            response.raise_for_status()
            result = response.json()
            
            content = result["choices"][0]["message"]["content"]
            usage = result.get("usage")
            
            return LLMResponse(
                content=content,
                usage=usage,
                model=self.model_name,
                finish_reason=result["choices"][0].get("finish_reason")
            )
            
        except Exception as e:
            logger.error(f"硅基流动调用失败: {str(e)}")
            raise
    
    def test_connection(self) -> bool:
        """测试硅基流动连接"""
        try:
            # 使用简单的测试提示
            response = self.call("测试", max_tokens=10)
            # 检查响应是否有效
            if response and response.content:
                return True
            return False
        except Exception as e:
            logger.error(f"硅基流动连接测试失败: {e}")
            return False
    
    def get_available_models(self) -> List[ModelInfo]:
        """获取硅基流动可用模型"""
        return [
            ModelInfo(
                name="Qwen/Qwen2.5-7B-Instruct",
                display_name="Qwen2.5-7B",
                provider=ProviderType.SILICONFLOW,
                max_tokens=32768,
                description="硅基流动Qwen2.5-7B模型"
            ),
            ModelInfo(
                name="Qwen/Qwen2.5-14B-Instruct",
                display_name="Qwen2.5-14B",
                provider=ProviderType.SILICONFLOW,
                max_tokens=32768,
                description="硅基流动Qwen2.5-14B模型"
            ),
            ModelInfo(
                name="Qwen/Qwen2.5-32B-Instruct",
                display_name="Qwen2.5-32B",
                provider=ProviderType.SILICONFLOW,
                max_tokens=32768,
                description="硅基流动Qwen2.5-32B模型"
            ),
            ModelInfo(
                name="deepseek-ai/DeepSeek-V2.5",
                display_name="DeepSeek-V2.5",
                provider=ProviderType.SILICONFLOW,
                max_tokens=65536,
                description="硅基流动DeepSeek-V2.5模型"
            )
        ]

class LLMProviderFactory:
    """LLM提供商工厂"""
    
    _providers = {
        ProviderType.DASHSCOPE: DashScopeProvider,
        ProviderType.OPENAI: OpenAIProvider,
        ProviderType.GEMINI: GeminiProvider,
        ProviderType.SILICONFLOW: SiliconFlowProvider,
        ProviderType.OLLAMA: OllamaProvider,
    }
    
    @classmethod
    def create_provider(cls, provider_type: ProviderType, api_key: str, model_name: str, **kwargs) -> LLMProvider:
        """创建提供商实例"""
        if provider_type not in cls._providers:
            raise ValueError(f"不支持的提供商类型: {provider_type}")
        
        provider_class = cls._providers[provider_type]
        return provider_class(api_key, model_name, **kwargs)
    
    @classmethod
    def get_all_available_models(cls) -> Dict[ProviderType, List[ModelInfo]]:
        """获取所有提供商的可用模型"""
        models = {}
        for provider_type, provider_class in cls._providers.items():
            try:
                # 创建临时实例来获取模型列表
                temp_provider = provider_class("dummy_key", "dummy_model")
                models[provider_type] = temp_provider.get_available_models()
            except Exception as e:
                logger.warning(f"无法获取{provider_type.value}的模型列表: {e}")
                models[provider_type] = []
        return models
