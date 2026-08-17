from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from ..auth import get_session, require_admin_token, verify_session_password
from ..contracts import (
    SearchServiceConfigUpdate,
    VerifyPasswordRequest,
)
from ..custom_intelligence_store import (
    EXECUTIONS_RETENTION,
    IntelligenceStoreError,
)
from ..intelligence_admin_config import (
    AdminPasswordRequest,
    DefaultRulesUpdate,
    DeepSeekConfigUpdate,
    public_deepseek_config,
    read_deepseek_key,
    save_deepseek_config,
    SMTPConfigUpdate,
)
from ..intelligence_email import (
    EmailConfigurationError,
    effective_smtp_config,
    public_smtp_config,
    test_smtp_configuration,
    validate_smtp_identity,
    validate_smtp_server,
)
from ..user_store import UserStoreError
from ..service_url import service_url_port, service_url_with_port
from . import custom_intelligence as ci


router = APIRouter()


@router.get(
    "/api/admin/custom-intelligence/search-config",
    dependencies=[Depends(require_admin_token)],
)
def get_admin_search_config() -> dict[str, object]:
    try:
        return ci._admin_search_config_payload()
    except Exception as exc:
        raise ci._handle_store_error(exc, "无法加载情报搜索服务配置") from exc


@router.post(
    "/api/admin/custom-intelligence/search-config",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_search_config(
    payload: SearchServiceConfigUpdate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    try:
        current = ci.effective_search_config()
        api_key = (payload.api_key or "").strip()
        if not api_key or "••" in api_key:
            api_key = current.api_key
        if payload.enabled and not api_key:
            raise HTTPException(status_code=400, detail="百度搜索 API Key 不能为空")
        requested_endpoint = payload.endpoint or current.endpoint
        endpoint = service_url_with_port(
            requested_endpoint,
            payload.port or service_url_port(requested_endpoint),
        )
        ci.store.save_search_config(
            enabled=payload.enabled,
            endpoint=endpoint,
            auth_header="Authorization",
            timeout_seconds=payload.timeout_seconds,
            updated_by_user_id=ci._admin_actor_id(authorization),
            api_key=api_key,
        )
        ci._audit_intelligence_event(
            authorization,
            "custom_intelligence_config_updated",
            action="replace" if payload.api_key and "••" not in payload.api_key else "update",
            target="baidu_search",
            metadata={"enabled": payload.enabled},
        )
        return ci._admin_search_config_payload()
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="百度搜索 Endpoint 或端口无效") from exc
    except Exception as exc:
        raise ci._handle_store_error(exc, "无法保存情报搜索服务配置") from exc


@router.post(
    "/api/admin/custom-intelligence/search-config/test",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_search_config_test(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    tested_at = datetime.now(timezone.utc).isoformat()
    try:
        result = ci.test_search_configuration()
    except Exception as exc:
        message = ci._test_error_message(exc)
        try:
            ci.store.save_search_test(status="failed", message=message, tested_at=tested_at)
        except Exception:
            pass
        ci._audit_intelligence_event(
            authorization,
            "custom_intelligence_connection_tested",
            action="test",
            target="baidu_search",
            result="failed",
        )
        return {
            "status": "failed",
            "message": message,
            "tested_at": tested_at,
        }
    try:
        ci.store.save_search_test(
            status="success",
            message=str(result.get("message") or "连接测试成功，服务可用。"),
            tested_at=tested_at,
        )
    except Exception:
        pass
    ci._audit_intelligence_event(
        authorization,
        "custom_intelligence_connection_tested",
        action="test",
        target="baidu_search",
    )
    return {
        "status": "success",
        "message": str(result.get("message") or "连接测试成功，服务可用。"),
        "tested_at": tested_at,
        "request_id": result.get("request_id"),
    }


@router.post(
    "/api/admin/custom-intelligence/search-config/reveal-key",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_search_config_reveal_key(
    payload: VerifyPasswordRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    if verify_session_password(get_session(authorization), payload.password):
        api_key = ci.effective_search_config().api_key
        if not api_key:
            raise HTTPException(status_code=404, detail="百度搜索 API Key 尚未配置")
        ci._audit_intelligence_event(
            authorization,
            "custom_intelligence_secret_revealed",
            action="reveal",
            target="baidu_search",
        )
        return {"api_key": api_key}
    ci._audit_intelligence_event(
        authorization,
        "custom_intelligence_secret_revealed",
        action="reveal",
        target="baidu_search",
        result="denied",
    )
    raise HTTPException(status_code=401, detail="管理员密码不正确")


@router.get(
    "/api/admin/custom-intelligence/llm-config",
    dependencies=[Depends(require_admin_token)],
)
def get_admin_llm_config() -> dict[str, object]:
    return public_deepseek_config()


@router.post(
    "/api/admin/custom-intelligence/llm-config",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_llm_config(
    payload: DeepSeekConfigUpdate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    if not payload.enabled:
        raise HTTPException(status_code=400, detail="DeepSeek 是情报规划与分析的必需服务，不能停用")
    try:
        result = save_deepseek_config(payload)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="DeepSeek 配置无效或无法保存") from exc
    ci._audit_intelligence_event(
        authorization,
        "custom_intelligence_config_updated",
        action="replace" if payload.api_key and "••" not in payload.api_key else "update",
        target="deepseek",
        metadata={"model": payload.model},
    )
    return result


@router.post(
    "/api/admin/custom-intelligence/llm-config/test",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_llm_config_test(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    tested_at = datetime.now(timezone.utc).isoformat()
    try:
        result = ci.test_deepseek_configuration()
    except Exception:
        ci._audit_intelligence_event(
            authorization,
            "custom_intelligence_connection_tested",
            action="test",
            target="deepseek",
            result="failed",
        )
        return {"status": "failed", "message": "DeepSeek 连接测试失败，请检查配置与网络。", "tested_at": tested_at}
    ci._audit_intelligence_event(
        authorization,
        "custom_intelligence_connection_tested",
        action="test",
        target="deepseek",
    )
    return {**result, "tested_at": tested_at}


@router.post(
    "/api/admin/custom-intelligence/llm-config/reveal-key",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_llm_config_reveal_key(
    payload: AdminPasswordRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    try:
        if not verify_session_password(get_session(authorization), payload.password):
            raise PermissionError("管理员密码不正确")
        api_key = read_deepseek_key()
    except PermissionError as exc:
        ci._audit_intelligence_event(
            authorization,
            "custom_intelligence_secret_revealed",
            action="reveal",
            target="deepseek",
            result="denied",
        )
        raise HTTPException(status_code=401, detail="管理员密码不正确") from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="DeepSeek 尚未配置") from exc
    ci._audit_intelligence_event(
        authorization,
        "custom_intelligence_secret_revealed",
        action="reveal",
        target="deepseek",
    )
    return {"api_key": api_key}


@router.get(
    "/api/admin/custom-intelligence/smtp-config",
    dependencies=[Depends(require_admin_token)],
)
def get_admin_smtp_config() -> dict[str, object]:
    return public_smtp_config(ci.store)


@router.post(
    "/api/admin/custom-intelligence/smtp-config",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_smtp_config(
    payload: SMTPConfigUpdate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    current = effective_smtp_config(ci.store)
    host = payload.host.strip() if payload.host is not None else current.host
    port = payload.port if payload.port is not None else current.port
    use_ssl = payload.use_ssl if payload.use_ssl is not None else current.use_ssl
    username = payload.username.strip()
    from_address = payload.from_address.strip() or username
    authorization_code = (payload.authorization_code or "").strip()
    replacing_secret = bool(authorization_code and "••" not in authorization_code)
    if not replacing_secret:
        authorization_code = current.authorization_code
    try:
        if payload.enabled or username or from_address:
            validate_smtp_server(host, port)
            validate_smtp_identity(username, from_address)
        if payload.enabled and not authorization_code:
            raise EmailConfigurationError("SMTP 客户端授权码不能为空")
        ci.store.save_smtp_config(
            enabled=payload.enabled,
            host=host,
            port=port,
            use_ssl=use_ssl,
            username=username,
            from_address=from_address,
            authorization_code=authorization_code,
            timeout_seconds=payload.timeout_seconds,
            updated_by_user_id=ci._admin_actor_id(authorization),
        )
    except (EmailConfigurationError, IntelligenceStoreError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    ci._audit_intelligence_event(
        authorization,
        "custom_intelligence_config_updated",
        action="replace" if replacing_secret else "update",
        target="smtp",
        metadata={"enabled": payload.enabled},
    )
    return public_smtp_config(ci.store)


@router.post(
    "/api/admin/custom-intelligence/smtp-config/test",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_smtp_config_test(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    tested_at = datetime.now(timezone.utc).isoformat()
    try:
        result = ci.test_smtp_configuration(effective_smtp_config(ci.store))
    except EmailConfigurationError as exc:
        ci._audit_intelligence_event(
            authorization,
            "custom_intelligence_connection_tested",
            action="test",
            target="smtp",
            result="failed",
        )
        return {"status": "failed", "message": str(exc), "tested_at": tested_at}
    ci._audit_intelligence_event(
        authorization,
        "custom_intelligence_connection_tested",
        action="test",
        target="smtp",
    )
    return {**result, "tested_at": tested_at}


@router.post(
    "/api/admin/custom-intelligence/smtp-config/reveal-authorization-code",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_smtp_config_reveal_authorization_code(
    payload: AdminPasswordRequest,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    if not verify_session_password(get_session(authorization), payload.password):
        ci._audit_intelligence_event(
            authorization,
            "custom_intelligence_secret_revealed",
            action="reveal",
            target="smtp",
            result="denied",
        )
        raise HTTPException(status_code=401, detail="管理员密码不正确")
    authorization_code = effective_smtp_config(ci.store).authorization_code
    if not authorization_code:
        raise HTTPException(status_code=404, detail="SMTP 客户端授权码尚未配置")
    ci._audit_intelligence_event(
        authorization,
        "custom_intelligence_secret_revealed",
        action="reveal",
        target="smtp",
    )
    return {"authorization_code": authorization_code}


@router.get(
    "/api/admin/custom-intelligence/default-rules",
    dependencies=[Depends(require_admin_token)],
)
def get_admin_default_rules() -> dict[str, object]:
    stored = ci.store.get_default_rules()
    rules = stored.get("rules") if isinstance(stored.get("rules"), dict) else {}
    return {
        **ci.DEFAULT_ANALYSIS_RULES,
        **rules,
        "updated_at": stored.get("updated_at"),
    }


@router.post(
    "/api/admin/custom-intelligence/default-rules",
    dependencies=[Depends(require_admin_token)],
)
def post_admin_default_rules(
    payload: DefaultRulesUpdate,
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    rules = payload.model_dump()
    try:
        stored = ci.store.save_default_rules(
            rules=rules,
            updated_by_user_id=ci._admin_actor_id(authorization),
        )
    except IntelligenceStoreError as exc:
        raise ci._handle_store_error(exc, "无法保存默认分析规则") from exc
    ci._audit_intelligence_event(
        authorization,
        "custom_intelligence_config_updated",
        action="update",
        target="default_rules",
    )
    return {**rules, "updated_at": stored.get("updated_at")}


@router.get(
    "/api/admin/custom-intelligence/executions",
    dependencies=[Depends(require_admin_token)],
)
def get_admin_executions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=50),
    owner_user_id: Annotated[int | None, Query(ge=0)] = None,
) -> dict[str, object]:
    if owner_user_id is not None:
        try:
            executions, meta = ci.store.list_executions(owner_user_id, page, page_size)
        except IntelligenceStoreError as exc:
            raise ci._handle_store_error(exc, "无法加载情报报告") from exc
        try:
            identities = ci.get_user_identities_by_ids({owner_user_id}) if owner_user_id > 0 else {}
        except UserStoreError:
            identities = {}
        return {
            "executions": [ci._admin_execution_summary(execution, identities) for execution in executions],
            "meta": meta,
        }

    recent = ci.store.list_recent_executions(limit=EXECUTIONS_RETENTION)
    total = len(recent)
    total_pages = max(1, (total + page_size - 1) // page_size)
    effective_page = min(page, total_pages)
    start = (effective_page - 1) * page_size
    executions = recent[start : start + page_size]
    try:
        identities = ci.get_user_identities_by_ids(
            {int(item["owner_user_id"]) for item in executions if int(item.get("owner_user_id") or 0) > 0}
        )
    except UserStoreError:
        identities = {}
    return {
        "executions": [ci._admin_execution_summary(execution, identities) for execution in executions],
        "meta": {
            "page": effective_page,
            "page_size": page_size,
            "total": total,
            "total_pages": total_pages,
        },
    }


@router.get(
    "/api/admin/custom-intelligence/executions/{execution_id}",
    dependencies=[Depends(require_admin_token)],
)
def get_admin_execution(execution_id: int) -> dict[str, object]:
    try:
        execution = ci.store.get_execution_by_id(execution_id)
    except Exception as exc:
        raise ci._handle_store_error(exc, "无法加载情报报告") from exc
    owner_user_id = int(execution.get("owner_user_id") or 0)
    try:
        identities = ci.get_user_identities_by_ids({owner_user_id}) if owner_user_id > 0 else {}
    except UserStoreError:
        identities = {}
    public = ci._public_execution(execution)
    public.update({"owner_user_id": owner_user_id, **ci._admin_owner_payload(owner_user_id, identities)})
    return {"execution": public}


@router.get(
    "/api/admin/custom-intelligence/executions/{execution_id}/diagnostics",
    dependencies=[Depends(require_admin_token)],
)
def get_admin_execution_diagnostics(execution_id: int) -> dict[str, object]:
    try:
        execution = ci.store.get_execution_by_id(execution_id)
    except Exception as exc:
        raise ci._handle_store_error(exc, "无法加载情报执行诊断") from exc
    return {"diagnostics": ci._admin_execution_diagnostics(execution)}
