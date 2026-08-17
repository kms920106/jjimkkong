# 네이버 로그인 API 개발 가이드 (핵심 정리)

> **원본 문서**: https://developers.naver.com/docs/login/devguide/devguide.md
> **기반 프로토콜**: OAuth 2.0
> **정리 목적**: AI 또는 개발자가 네이버 로그인 연동 시 빠르게 참고하기 위한 요약

---

## 1. 개요

네이버 로그인은 **OAuth 2.0 기반의 사용자 인증 서비스**로, 외부 서비스에서 네이버 계정을 통해 간편하게 로그인할 수 있게 해준다. 사용자의 이름, 이메일, 프로필 사진, 성별, 연령대 등을 API로 조회할 수 있다.

---

## 2. 사전 준비: 애플리케이션 등록

### 등록 절차

1. [네이버 개발자 센터](https://developers.naver.com) 접속
2. **Application > 애플리케이션 등록** 메뉴 선택
3. 이용약관 동의 → 휴대폰 인증 → 회사이름 입력
4. 애플리케이션 정보 입력 후 등록

### 필수 입력 항목

| 항목 | 설명 |
|------|------|
| **애플리케이션 이름** | 네이버 로그인 동의 화면에 표시됨 |
| **사용 API** | `네이버 로그인` 선택 |
| **제공 정보 선택** | 필수/추가로 구분하여 사용자 정보 항목 선택 |
| **서비스 환경** | PC웹, 모바일웹, Android, iOS 등 |
| **서비스 URL** | 로그인 버튼이 있는 페이지의 URL |
| **Callback URL** | 인증 완료 후 리다이렉트될 URL |

### 발급 결과

- **Client ID**: 애플리케이션 식별자
- **Client Secret**: 애플리케이션 비밀키

> ⚠️ **주의**: 네이버는 필수 정보조차 사용자가 임의로 거부할 수 있으므로, 사용자 정보 검증 로직이 중요하다.

---

## 3. 인증 플로우 (Authorization Code Grant)

```
[사용자] → 로그인 버튼 클릭
    ↓
[서비스] → 네이버 인증 URL로 리다이렉트
    ↓
[네이버] → 로그인 + 동의 화면 표시
    ↓
[네이버] → Callback URL로 code, state 전달
    ↓
[서비스] → code로 Access Token 요청
    ↓
[서비스] → Access Token으로 프로필 API 호출
```

---

## 4. API 상세

### 4.1 네이버 로그인 인증 요청 (Step 1)

네이버 로그인 화면을 띄워 사용자 인증을 요청한다.

**요청 URL**

```
GET https://nid.naver.com/oauth2.0/authorize
```

**요청 파라미터**

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `response_type` | Y | `code` 고정 |
| `client_id` | Y | 발급받은 Client ID |
| `redirect_uri` | Y | 등록한 Callback URL (URL 인코딩) |
| `state` | Y | CSRF 방지용 상태 토큰 (랜덤 문자열) |
| `auth_type` | N | `reauthenticate` 설정 시 기존 로그인 여부와 무관하게 재로그인 요구 |

**요청 예시**

```
https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=CLIENT_ID&state=STATE_STRING&redirect_uri=CALLBACK_URL
```

**응답 (Callback URL로 리다이렉트)**

- 성공 시: `{CALLBACK_URL}?code={CODE}&state={STATE}`
- 실패 시: `{CALLBACK_URL}?state={STATE}&error={ERROR_CODE}&error_description={ERROR_MSG}`

---

### 4.2 접근 토큰 발급 (Step 2)

Callback에서 받은 `code`로 Access Token을 발급받는다.

**요청 URL**

```
GET/POST https://nid.naver.com/oauth2.0/token
```

**요청 파라미터**

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `grant_type` | Y | `authorization_code` |
| `client_id` | Y | Client ID |
| `client_secret` | Y | Client Secret |
| `code` | Y | Callback으로 전달받은 인가 코드 |
| `state` | Y | Callback으로 전달받은 state 값 |

**요청 예시**

```
https://nid.naver.com/oauth2.0/token?grant_type=authorization_code&client_id={CLIENT_ID}&client_secret={CLIENT_SECRET}&code={CODE}&state={STATE}
```

**응답 예시 (JSON)**

```json
{
  "access_token": "AAAAQosjWDJieBiQZc3to9YQp6HDLvrmyKC...",
  "refresh_token": "c8ceMEJisO4Se7uGisHoX0f5JEii7JnipglQipkOn5Zp3tyP7dHQoP0zNKHUq2gY",
  "token_type": "bearer",
  "expires_in": "3600"
}
```

> ⚠️ `code` 값은 **1회만 사용 가능**하며, 토큰 발급 후 재사용 불가.

---

### 4.3 접근 토큰 갱신 (Refresh)

Access Token의 유효기간(약 1시간)이 만료되면 Refresh Token으로 재발급한다.

**요청 URL**

```
GET/POST https://nid.naver.com/oauth2.0/token
```

**요청 파라미터**

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `grant_type` | Y | `refresh_token` |
| `client_id` | Y | Client ID |
| `client_secret` | Y | Client Secret |
| `refresh_token` | Y | 발급받은 Refresh Token |

**응답 예시 (JSON)**

```json
{
  "access_token": "AAAAQjbRkysCNmMdQ7kmowPrjyRNIRYKG2iGHhbGawP0...",
  "token_type": "bearer",
  "expires_in": "3600"
}
```

---

### 4.4 접근 토큰 삭제 (연동 해제)

사용자의 네이버 로그인 연동을 해제(탈퇴 처리)할 때 사용한다.

**요청 URL**

```
GET/POST https://nid.naver.com/oauth2.0/token
```

**요청 파라미터**

| 파라미터 | 필수 | 설명 |
|----------|------|------|
| `grant_type` | Y | `delete` |
| `client_id` | Y | Client ID |
| `client_secret` | Y | Client Secret |
| `access_token` | Y | 삭제할 Access Token |
| `service_provider` | Y | `NAVER` 고정 |

---

### 4.5 프로필 정보 조회 (Step 3)

발급받은 Access Token으로 사용자 프로필을 조회한다.

**요청 URL**

```
GET https://openapi.naver.com/v1/nid/me
```

**요청 헤더**

```
Authorization: Bearer {ACCESS_TOKEN}
```

**응답에서 조회 가능한 사용자 정보**

| 필드 | 설명 |
|------|------|
| `id` | 네이버 고유 사용자 식별자 (동일인 식별용) |
| `email` | 이메일 주소 |
| `name` | 이름 |
| `nickname` | 별명 |
| `profile_image` | 프로필 사진 URL |
| `age` | 연령대 |
| `gender` | 성별 (M/F) |
| `birthday` | 생일 (MM-DD) |
| `birthyear` | 출생연도 |
| `mobile` | 휴대전화번호 |

> ⚠️ 응답 구조: 사용자 정보는 `response` 객체 안에 담겨 전달된다.

**응답 구조 예시**

```json
{
  "resultcode": "00",
  "message": "success",
  "response": {
    "id": "32742776",
    "email": "user@example.com",
    "name": "홍길동",
    "nickname": "길동이",
    "profile_image": "https://...",
    "age": "20-29",
    "gender": "M",
    "birthday": "01-01",
    "birthyear": "1990",
    "mobile": "010-1234-5678"
  }
}
```

---

## 5. 주요 URL 정리

| 용도 | URL |
|------|-----|
| 인증 요청 | `https://nid.naver.com/oauth2.0/authorize` |
| 토큰 발급/갱신/삭제 | `https://nid.naver.com/oauth2.0/token` |
| 프로필 조회 | `https://openapi.naver.com/v1/nid/me` |

---

## 6. Spring Boot 연동 설정 (application.properties)

```properties
# Registration
spring.security.oauth2.client.registration.naver.client-id={CLIENT_ID}
spring.security.oauth2.client.registration.naver.client-secret={CLIENT_SECRET}
spring.security.oauth2.client.registration.naver.redirect-uri={CALLBACK_URL}
spring.security.oauth2.client.registration.naver.scope=name,email,profile_image
spring.security.oauth2.client.registration.naver.authorization-grant-type=authorization_code

# Provider
spring.security.oauth2.client.provider.naver.authorization-uri=https://nid.naver.com/oauth2.0/authorize
spring.security.oauth2.client.provider.naver.token-uri=https://nid.naver.com/oauth2.0/token
spring.security.oauth2.client.provider.naver.user-info-uri=https://openapi.naver.com/v1/nid/me
spring.security.oauth2.client.provider.naver.user-name-attribute=response
```

> ⚠️ `user-name-attribute`는 반드시 `response`로 설정해야 한다. 네이버는 유저 정보를 `response` 객체 안에 담아 전달하기 때문이다.

---

## 7. 검수 및 서비스 적용

### 검수 전 테스트

- 검수 미완료 상태에서도 **본인 계정** 및 **멤버 관리에 등록된 계정**으로 테스트 가능
- 일반 사용자 대상 서비스 적용은 **검수 통과 후** 가능

### 검수 요청 시 필요 자료

1. 애플리케이션 로고 이미지
2. 네이버 로그인 적용 화면 캡처 (로그인 Flow)
3. 사용자 정보 활용처 캡처
4. 회원가입 정보 입력 상세 화면 캡처

### 주의사항

- 제공 정보 항목과 실제 서비스에서 받는 가입 정보가 다르면 **심사 거절**됨
- 로그인 버튼은 [네이버 공식 디자인 가이드](https://developers.naver.com/docs/login/bi/bi.md)를 따를 것 (녹색 버튼 권장)

---

## 8. 보안 고려사항

### state 파라미터 (CSRF 방지)

- 인증 요청 시 **랜덤 문자열을 생성**하여 `state`로 전송
- Callback 수신 시 세션에 저장한 값과 비교하여 **일치 여부 검증**
- 불일치 시 요청을 거부하여 CSRF 공격 방지

### Access Token 관리

- Access Token의 유효기간은 약 **1시간**
- 만료 시 Refresh Token으로 갱신 (사용자 재인증 불필요)
- 서비스 탈퇴 시 반드시 `grant_type=delete`로 토큰 삭제 처리

---

## 9. 빠른 참조: 전체 플로우 코드 스니펫

### JavaScript (프론트엔드 - 로그인 URL 생성)

```javascript
const client_id = "YOUR_CLIENT_ID";
const redirectURI = encodeURIComponent("YOUR_CALLBACK_URL");
const state = crypto.randomUUID(); // 랜덤 상태 토큰

const loginURL = `https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id=${client_id}&redirect_uri=${redirectURI}&state=${state}`;

window.location.href = loginURL;
```

### 백엔드 (토큰 발급 요청)

```
POST https://nid.naver.com/oauth2.0/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&client_id={CLIENT_ID}
&client_secret={CLIENT_SECRET}
&code={CALLBACK에서_받은_CODE}
&state={CALLBACK에서_받은_STATE}
```

### 백엔드 (프로필 조회)

```
GET https://openapi.naver.com/v1/nid/me
Authorization: Bearer {ACCESS_TOKEN}
```

---

## 10. 에러 처리

인증 실패 시 Callback URL로 에러 정보가 전달된다:

```
{CALLBACK_URL}?state={STATE}&error={ERROR_CODE}&error_description={ERROR_MSG}
```

토큰 관련 API 호출 실패 시에도 JSON 응답으로 에러 코드와 메시지가 반환되므로, 적절한 에러 핸들링이 필요하다.
